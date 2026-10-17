/* SocketHelper_e3.c --- E3 draft: complete x86_64 com.leiting.sdk.SocketHelper with call logging.
 *
 * Build (one translation unit; reuses the VERIFIED DES H/G from SocketHelper.c by renaming its JNI symbols):
 *   $NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/x86_64-linux-android21-clang \
 *       -shared -fPIC -O2 -o libSocketHelper.so SocketHelper_e3.c -llog
 * (Do NOT also link gen/libSocketHelper.c: this file defines every letter itself.)
 *
 * Every call logs one line:  I/X86SH: <name> in=<len> -> <len|NULL>
 * so the next run shows exactly which natives the SDK uses at startup.
 *
 * Semantics recovered from the arm64 libSocketHelper.so (sh_walk: wrapper -> PLT -> helper, rodata 0x3b4f0..0x3b597):
 *   H/G   (String)String  DES/ECB/PKCS5 hex, key "548711fdc20a2129"   (verified in E2; reused from SocketHelper.c)
 *   E/F   (String)String  same DES-hex path, key kk1 = "leiting"       (E=encode, F=decode)
 *   k/L   (String,String) same DES-hex path, key = 2nd Java arg       (k=encode, L=decode; arg order inferred)
 *   A/B   (String)String  AES-128-ECB, key "#LeitingAESKey#!"          (A=enc, B=dec)
 *   C/D   (String)String  AES-128-CBC, key "#LeitingAESKey#!", iv "LeitingAESIVKEY!"
 *   N/O   (String)String  AES-128-CBC, key "#LeitingWEBAES#!", iv "LeitingWEBAESIV!"
 *   CW/DW (String)String  AES-128-CBC, key = iv = "E3LfXBuk68bvhHyt"
 *         AES helper = encryptByAES(data,key,iv,mode): zero-pad -> AES -> base64_encode;
 *         decryptByAES: base64_decode -> AES -> C string (trailing zeros dropped).  Zero padding = inference.
 *   I/J   (String)String  TBase64 encode / decode (standard alphabet, '=' padding)
 *   M     (byte[],String)String  CDES::DeCodeByByte, ECB, key = String arg  (padding handling inferred)
 *   G1..G5 ()String       key getters: "leiting", "#Leiting#", "leitingpay", 32-hex, "key123456789"
 *   Run/Release ()V       socket hook (xhook) init / shutdown -> no-op here (emulator, private server)
 * DES in the original goes through Java (SocketHelper.getKey([B) / hexStr2ByteArr / byteArr2HexStr +
 * javax.crypto "DES/ECB/PKCS5Padding"); we call the same Java helpers so behaviour is identical.
 */
#define Java_com_leiting_sdk_SocketHelper_H       sh_old_H
#define Java_com_leiting_sdk_SocketHelper_G       sh_old_G
#define Java_com_leiting_sdk_SocketHelper_A       sh_old_A
#define Java_com_leiting_sdk_SocketHelper_B       sh_old_B
#define Java_com_leiting_sdk_SocketHelper_Run     sh_old_Run
#define Java_com_leiting_sdk_SocketHelper_Release sh_old_Release
#define JNI_OnLoad                                sh_old_JNI_OnLoad
#include "SocketHelper.c"
#undef Java_com_leiting_sdk_SocketHelper_H
#undef Java_com_leiting_sdk_SocketHelper_G
#undef Java_com_leiting_sdk_SocketHelper_A
#undef Java_com_leiting_sdk_SocketHelper_B
#undef Java_com_leiting_sdk_SocketHelper_Run
#undef Java_com_leiting_sdk_SocketHelper_Release
#undef JNI_OnLoad

#include <android/log.h>

#define TAG "X86SH"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)

static int jlen(JNIEnv *env, jstring s) { return s ? (*env)->GetStringUTFLength(env, s) : -1; }
static jstring trace(JNIEnv *env, const char *name, jstring in, jstring out) {
    LOGI("%s in=%d -> %d%s", name, jlen(env, in), jlen(env, out), out ? "" : " NULL");
    return out;
}
static int clear_exc(JNIEnv *env, const char *where) {
    if (!(*env)->ExceptionCheck(env)) return 0;
    LOGI("%s: java exception (cleared)", where);
    (*env)->ExceptionDescribe(env);
    (*env)->ExceptionClear(env);
    return 1;
}
static jbyteArray to_jbytes(JNIEnv *env, const void *p, int n) {
    jbyteArray a = (*env)->NewByteArray(env, n);
    if (a && n) (*env)->SetByteArrayRegion(env, a, 0, n, (const jbyte *)p);
    return a;
}

/* ------------------------------- base64 -------------------------------- */
static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static char *b64_enc(const uint8_t *in, int n) {
    char *o = malloc((n + 2) / 3 * 4 + 1), *p = o;
    for (int i = 0; i < n; i += 3) {
        uint32_t v = in[i] << 16 | (i + 1 < n ? in[i + 1] << 8 : 0) | (i + 2 < n ? in[i + 2] : 0);
        *p++ = B64[v >> 18 & 63]; *p++ = B64[v >> 12 & 63];
        *p++ = i + 1 < n ? B64[v >> 6 & 63] : '=';
        *p++ = i + 2 < n ? B64[v & 63] : '=';
    }
    *p = 0;
    return o;
}
static int b64_dec(const char *in, uint8_t *o) {   /* skips non-alphabet chars (\r\n), stops at '=' */
    uint32_t v = 0; int bits = 0, n = 0;
    for (; *in && *in != '='; in++) {
        const char *q = strchr(B64, *in);
        if (!q || !*in) continue;
        v = v << 6 | (uint32_t)(q - B64); bits += 6;
        if (bits >= 8) { bits -= 8; o[n++] = (uint8_t)(v >> bits); }
    }
    return n;
}

/* ------------------- javax.crypto via JNI (no C AES needed) ------------------- */
/* mode: 1 = ENCRYPT_MODE, 2 = DECRYPT_MODE.  Returns malloc'd buffer, *outn = length, or NULL. */
static uint8_t *jcipher(JNIEnv *env, const char *transform, const char *alg, const uint8_t *key, int klen,
                        const uint8_t *iv, int mode, const uint8_t *in, int inn, int *outn) {
    uint8_t *res = NULL;
    jclass cSpec = (*env)->FindClass(env, "javax/crypto/spec/SecretKeySpec");
    jclass cCipher = (*env)->FindClass(env, "javax/crypto/Cipher");
    if (clear_exc(env, "FindClass")) return NULL;
    jobject k = (*env)->NewObject(env, cSpec, (*env)->GetMethodID(env, cSpec, "<init>", "([BLjava/lang/String;)V"),
                                  to_jbytes(env, key, klen), (*env)->NewStringUTF(env, alg));
    jobject c = (*env)->CallStaticObjectMethod(env, cCipher,
        (*env)->GetStaticMethodID(env, cCipher, "getInstance", "(Ljava/lang/String;)Ljavax/crypto/Cipher;"),
        (*env)->NewStringUTF(env, transform));
    if (clear_exc(env, transform) || !k || !c) return NULL;
    if (iv) {
        jclass cIv = (*env)->FindClass(env, "javax/crypto/spec/IvParameterSpec");
        jobject ivs = (*env)->NewObject(env, cIv, (*env)->GetMethodID(env, cIv, "<init>", "([B)V"), to_jbytes(env, iv, 16));
        (*env)->CallVoidMethod(env, c, (*env)->GetMethodID(env, cCipher, "init",
            "(ILjava/security/Key;Ljava/security/spec/AlgorithmParameterSpec;)V"), mode, k, ivs);
    } else {
        (*env)->CallVoidMethod(env, c, (*env)->GetMethodID(env, cCipher, "init", "(ILjava/security/Key;)V"), mode, k);
    }
    if (clear_exc(env, "Cipher.init")) return NULL;
    jbyteArray out = (*env)->CallObjectMethod(env, c, (*env)->GetMethodID(env, cCipher, "doFinal", "([B)[B"),
                                              to_jbytes(env, in, inn));
    if (clear_exc(env, "Cipher.doFinal") || !out) return NULL;
    *outn = (*env)->GetArrayLength(env, out);
    res = malloc(*outn + 1);
    (*env)->GetByteArrayRegion(env, out, 0, *outn, (jbyte *)res);
    res[*outn] = 0;
    return res;
}

/* encryptByAES / decryptByAES equivalents (zero padding, base64 text) */
static jstring aes_enc(JNIEnv *env, jstring s, const char *key, const char *iv) {
    if (!s) return NULL;
    const char *p = (*env)->GetStringUTFChars(env, s, NULL);
    int n = (int)strlen(p), tot = n % 16 ? n + 16 - n % 16 : (n ? n : 16), cn = 0;
    uint8_t *buf = calloc(1, tot);
    memcpy(buf, p, n);
    (*env)->ReleaseStringUTFChars(env, s, p);
    uint8_t *ct = jcipher(env, iv ? "AES/CBC/NoPadding" : "AES/ECB/NoPadding", "AES",
                          (const uint8_t *)key, 16, (const uint8_t *)iv, 1, buf, tot, &cn);
    free(buf);
    if (!ct) return NULL;
    char *b = b64_enc(ct, cn);
    jstring r = (*env)->NewStringUTF(env, b);
    free(ct); free(b);
    return r;
}
static jstring aes_dec(JNIEnv *env, jstring s, const char *key, const char *iv) {
    if (!s) return NULL;
    const char *p = (*env)->GetStringUTFChars(env, s, NULL);
    uint8_t *raw = malloc(strlen(p) + 1);
    int n = b64_dec(p, raw), pn = 0;
    (*env)->ReleaseStringUTFChars(env, s, p);
    uint8_t *pt = (n && n % 16 == 0) ? jcipher(env, iv ? "AES/CBC/NoPadding" : "AES/ECB/NoPadding", "AES",
                                              (const uint8_t *)key, 16, (const uint8_t *)iv, 2, raw, n, &pn) : NULL;
    free(raw);
    if (!pt) return NULL;
    jstring r = (*env)->NewStringUTF(env, (char *)pt);   /* C-string semantics drop the zero padding */
    free(pt);
    return r;
}

/* DesByJ::encodeAndHexToByte / decodeAndHexToByte, through the same Java helpers the original calls */
static jstring des_hex(JNIEnv *env, jstring s, const char *key, int enc) {
    if (!s || !key) return NULL;
    jclass sh = (*env)->FindClass(env, "com/leiting/sdk/SocketHelper");
    if (clear_exc(env, "FindClass SocketHelper")) return NULL;
    jmethodID getKey = (*env)->GetStaticMethodID(env, sh, "getKey", "([B)Ljava/security/Key;");
    if (clear_exc(env, "getKey")) return NULL;
    jobject k = (*env)->CallStaticObjectMethod(env, sh, getKey, to_jbytes(env, key, (int)strlen(key)));
    jclass cCipher = (*env)->FindClass(env, "javax/crypto/Cipher");
    jobject c = (*env)->CallStaticObjectMethod(env, cCipher,
        (*env)->GetStaticMethodID(env, cCipher, "getInstance", "(Ljava/lang/String;)Ljavax/crypto/Cipher;"),
        (*env)->NewStringUTF(env, "DES/ECB/PKCS5Padding"));
    if (clear_exc(env, "DES getInstance") || !k || !c) return NULL;
    (*env)->CallVoidMethod(env, c, (*env)->GetMethodID(env, cCipher, "init", "(ILjava/security/Key;)V"), enc ? 1 : 2, k);
    if (clear_exc(env, "DES init")) return NULL;
    jmethodID doFinal = (*env)->GetMethodID(env, cCipher, "doFinal", "([B)[B");
    jclass cStr = (*env)->FindClass(env, "java/lang/String");
    jstring utf8 = (*env)->NewStringUTF(env, "UTF-8");
    if (enc) {
        jobject in = (*env)->CallObjectMethod(env, s,
            (*env)->GetMethodID(env, cStr, "getBytes", "(Ljava/lang/String;)[B"), utf8);
        jobject ct = (*env)->CallObjectMethod(env, c, doFinal, in);
        if (clear_exc(env, "DES enc") || !ct) return NULL;
        jobject hex = (*env)->CallStaticObjectMethod(env, sh,
            (*env)->GetStaticMethodID(env, sh, "byteArr2HexStr", "([B)Ljava/lang/String;"), ct);
        return clear_exc(env, "byteArr2HexStr") ? NULL : (jstring)hex;
    }
    jobject bytes = (*env)->CallStaticObjectMethod(env, sh,
        (*env)->GetStaticMethodID(env, sh, "hexStr2ByteArr", "(Ljava/lang/String;)[B"), s);
    if (clear_exc(env, "hexStr2ByteArr") || !bytes) return NULL;
    jobject pt = (*env)->CallObjectMethod(env, c, doFinal, bytes);
    if (clear_exc(env, "DES dec") || !pt) return NULL;
    jobject r = (*env)->NewObject(env, cStr, (*env)->GetMethodID(env, cStr, "<init>", "([BLjava/lang/String;)V"), pt, utf8);
    return clear_exc(env, "new String") ? NULL : (jstring)r;
}
static jstring des_hex_jkey(JNIEnv *env, jstring s, jstring key, int enc) {
    if (!key) return NULL;
    const char *k = (*env)->GetStringUTFChars(env, key, NULL);
    jstring r = des_hex(env, s, k, enc);
    (*env)->ReleaseStringUTFChars(env, key, k);
    return r;
}

/* --------------------------------- JNI --------------------------------- */
#define SH(name) JNIEXPORT jstring JNICALL Java_com_leiting_sdk_SocketHelper_##name

static const char K_AES[] = "#LeitingAESKey#!", IV_AES[] = "LeitingAESIVKEY!";
static const char K_WEB[] = "#LeitingWEBAES#!", IV_WEB[] = "LeitingWEBAESIV!";
static const char K_CW[] = "E3LfXBuk68bvhHyt";

SH(H)(JNIEnv *e, jobject t, jstring s) { return trace(e, "H", s, sh_old_H(e, t, s)); }
SH(G)(JNIEnv *e, jobject t, jstring s) { return trace(e, "G", s, sh_old_G(e, t, s)); }
SH(E)(JNIEnv *e, jobject t, jstring s) { return trace(e, "E", s, des_hex(e, s, "leiting", 1)); }
SH(F)(JNIEnv *e, jobject t, jstring s) { return trace(e, "F", s, des_hex(e, s, "leiting", 0)); }
SH(k)(JNIEnv *e, jobject t, jstring s, jstring key) { return trace(e, "k", s, des_hex_jkey(e, s, key, 1)); }
SH(L)(JNIEnv *e, jobject t, jstring s, jstring key) { return trace(e, "L", s, des_hex_jkey(e, s, key, 0)); }
SH(A)(JNIEnv *e, jobject t, jstring s) { return trace(e, "A", s, aes_enc(e, s, K_AES, NULL)); }
SH(B)(JNIEnv *e, jobject t, jstring s) { return trace(e, "B", s, aes_dec(e, s, K_AES, NULL)); }
SH(C)(JNIEnv *e, jobject t, jstring s) { return trace(e, "C", s, aes_enc(e, s, K_AES, IV_AES)); }
SH(D)(JNIEnv *e, jobject t, jstring s) { return trace(e, "D", s, aes_dec(e, s, K_AES, IV_AES)); }
SH(N)(JNIEnv *e, jobject t, jstring s) { return trace(e, "N", s, aes_enc(e, s, K_WEB, IV_WEB)); }
SH(O)(JNIEnv *e, jobject t, jstring s) { return trace(e, "O", s, aes_dec(e, s, K_WEB, IV_WEB)); }
SH(CW)(JNIEnv *e, jobject t, jstring s) { return trace(e, "CW", s, aes_enc(e, s, K_CW, K_CW)); }
SH(DW)(JNIEnv *e, jobject t, jstring s) { return trace(e, "DW", s, aes_dec(e, s, K_CW, K_CW)); }

SH(I)(JNIEnv *e, jobject t, jstring s) {
    if (!s) return trace(e, "I", s, NULL);
    const char *p = (*e)->GetStringUTFChars(e, s, NULL);
    char *b = b64_enc((const uint8_t *)p, (int)strlen(p));
    (*e)->ReleaseStringUTFChars(e, s, p);
    jstring r = (*e)->NewStringUTF(e, b);
    free(b);
    return trace(e, "I", s, r);
}
SH(J)(JNIEnv *e, jobject t, jstring s) {
    if (!s) return trace(e, "J", s, NULL);
    const char *p = (*e)->GetStringUTFChars(e, s, NULL);
    uint8_t *o = malloc(strlen(p) + 1);
    int n = b64_dec(p, o);
    o[n] = 0;
    (*e)->ReleaseStringUTFChars(e, s, p);
    jstring r = (*e)->NewStringUTF(e, (char *)o);
    free(o);
    return trace(e, "J", s, r);
}
/* M(byte[] data, String key): CDES::DeCodeByByte(ECB). Strip PKCS5 if valid, else trailing zeros (inferred). */
SH(M)(JNIEnv *e, jobject t, jbyteArray data, jstring key) {
    if (!data || !key) return trace(e, "M", key, NULL);
    int n = (*e)->GetArrayLength(e, data), pn = 0;
    uint8_t *in = malloc(n ? n : 1), k8[8] = {0};
    (*e)->GetByteArrayRegion(e, data, 0, n, (jbyte *)in);
    const char *k = (*e)->GetStringUTFChars(e, key, NULL);
    memcpy(k8, k, strlen(k) < 8 ? strlen(k) : 8);
    (*e)->ReleaseStringUTFChars(e, key, k);
    uint8_t *pt = (n && n % 8 == 0) ? jcipher(e, "DES/ECB/NoPadding", "DES", k8, 8, NULL, 2, in, n, &pn) : NULL;
    free(in);
    jstring r = NULL;
    if (pt) {
        int pad = pt[pn - 1];
        if (pad >= 1 && pad <= 8) { int ok = 1; for (int i = 0; i < pad; i++) ok &= pt[pn - 1 - i] == pad; if (ok) pt[pn - pad] = 0; }
        r = (*e)->NewStringUTF(e, (char *)pt);
        free(pt);
    }
    LOGI("M bytes=%d -> %d%s", n, jlen(e, r), r ? "" : " NULL");
    return r;
}

SH(G1)(JNIEnv *e, jobject t) { return trace(e, "G1", NULL, (*e)->NewStringUTF(e, "leiting")); }
SH(G2)(JNIEnv *e, jobject t) { return trace(e, "G2", NULL, (*e)->NewStringUTF(e, "#Leiting#")); }
SH(G3)(JNIEnv *e, jobject t) { return trace(e, "G3", NULL, (*e)->NewStringUTF(e, "leitingpay")); }
SH(G4)(JNIEnv *e, jobject t) { return trace(e, "G4", NULL, (*e)->NewStringUTF(e, "f6c3f2c274be025ac953aadcb548212d")); }
SH(G5)(JNIEnv *e, jobject t) { return trace(e, "G5", NULL, (*e)->NewStringUTF(e, "key123456789")); }

JNIEXPORT void JNICALL Java_com_leiting_sdk_SocketHelper_Run(JNIEnv *e, jobject t) { LOGI("Run (socket hook skipped)"); }
JNIEXPORT void JNICALL Java_com_leiting_sdk_SocketHelper_Release(JNIEnv *e, jobject t) { LOGI("Release"); }

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    LOGI("libSocketHelper(x86_64 E3) loaded");
    return JNI_VERSION_1_6;
}
