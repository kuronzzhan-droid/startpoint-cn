/* SocketHelper.c  ---  x86_64 re-implementation of com.leiting.sdk.SocketHelper
 *
 * DRAFT for route A (keep ijiami shell, add lib/x86_64/).  Compile with NDK clang:
 *     $NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/x86_64-linux-android21-clang \
 *         -shared -fPIC -O2 -o libSocketHelper.so SocketHelper.c
 *
 * Only H() is required to pass the first E0 crash (DesUtil.decryptConfig -> SocketHelper.H).
 * H/G are VERIFIED against the real local config (see des_ref.py / X86-STUBS-PLAN.md):
 *     H(hex) = DES/ECB/PKCS5 decrypt, key = ASCII "548711fd", returns UTF-8 plaintext
 *     G(str) = DES/ECB/PKCS5 encrypt, same key,             returns lowercase hex
 * Test vector (from des_ref.py):
 *     H("cc590f74c86d450653021a2b2e695d3d") == "hello, leiting"
 *
 * The other letters (A/B/C/D AES-CBC, N/O web-AES, CW/DW, E/F, G1..G5) are left as
 * null-returning stubs here; their key material is documented in the plan and can be
 * filled in the same shape once a running trace shows the SDK actually calls them.
 */
#include <jni.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>

/* ----------------------------- DES core (ECB) ----------------------------- */
/* Standard FIPS-46 tables. Public, non-secret. */
static const uint8_t IP[64]={58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,
62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,
59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7};
static const uint8_t FP[64]={40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,
38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,
35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25};
static const uint8_t E[48]={32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,
14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,
30,31,32,1};
static const uint8_t P[32]={16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,
2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25};
static const uint8_t PC1[56]={57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,
59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,
30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4};
static const uint8_t PC2[48]={14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,
26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,
34,53,46,42,50,36,29,32};
static const uint8_t SHIFT[16]={1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1};
static const uint8_t S[8][64]={
{14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,
4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13},
{15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,
0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9},
{10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,
13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12},
{7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,
10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14},
{2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,
4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3},
{12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,
9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13},
{4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,
1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12},
{13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,
7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11}};

static void permute(const uint8_t *in,uint8_t *out,const uint8_t *tbl,int n){
    for(int i=0;i<n;i++) out[i]=in[tbl[i]-1];
}
static void bytes2bits(const uint8_t *b,uint8_t *bits,int nbytes){
    for(int i=0;i<nbytes;i++) for(int j=0;j<8;j++) bits[i*8+j]=(b[i]>>(7-j))&1;
}
static void bits2bytes(const uint8_t *bits,uint8_t *b,int nbits){
    memset(b,0,nbits/8);
    for(int i=0;i<nbits;i++) b[i/8]|=bits[i]<<(7-(i%8));
}
static void des_keys(const uint8_t key[8],uint8_t sub[16][48]){
    uint8_t kb[64],pc1[56],c[28],d[28];
    bytes2bits(key,kb,8); permute(kb,pc1,PC1,56);
    memcpy(c,pc1,28); memcpy(d,pc1+28,28);
    for(int r=0;r<16;r++){
        for(int s=0;s<SHIFT[r];s++){
            uint8_t t=c[0]; memmove(c,c+1,27); c[27]=t;
            t=d[0]; memmove(d,d+1,27); d[27]=t;
        }
        uint8_t cd[56]; memcpy(cd,c,28); memcpy(cd+28,d,28);
        permute(cd,sub[r],PC2,48);
    }
}
static void des_block(const uint8_t in[8],uint8_t out[8],uint8_t sub[16][48],int enc){
    uint8_t bits[64],ip[64],L[32],R[32];
    bytes2bits(in,bits,8); permute(bits,ip,IP,64);
    memcpy(L,ip,32); memcpy(R,ip+32,32);
    for(int r=0;r<16;r++){
        int rr=enc?r:15-r;
        uint8_t er[48]; permute(R,er,E,48);
        for(int i=0;i<48;i++) er[i]^=sub[rr][i];
        uint8_t sout[32];
        for(int b=0;b<8;b++){
            int row=(er[b*6]<<1)|er[b*6+5];
            int col=(er[b*6+1]<<3)|(er[b*6+2]<<2)|(er[b*6+3]<<1)|er[b*6+4];
            int v=S[b][row*16+col];
            for(int k=0;k<4;k++) sout[b*4+k]=(v>>(3-k))&1;
        }
        uint8_t ps[32]; permute(sout,ps,P,32);
        uint8_t nR[32];
        for(int i=0;i<32;i++) nR[i]=L[i]^ps[i];
        memcpy(L,R,32); memcpy(R,nR,32);
    }
    uint8_t pre[64]; memcpy(pre,R,32); memcpy(pre+32,L,32);
    uint8_t fp[64]; permute(pre,fp,FP,64); bits2bytes(fp,out,64);
}
/* ECB over whole buffer; len must be a multiple of 8 */
static int des_ecb(const uint8_t *in,int len,uint8_t *out,const uint8_t key[8],int enc){
    if(len%8) return -1;
    uint8_t sub[16][48]; des_keys(key,sub);
    for(int i=0;i<len;i+=8) des_block(in+i,out+i,sub,enc);
    return 0;
}

/* ------------------------------ hex + pkcs5 ------------------------------- */
static int hex2bin(const char *h,uint8_t *o){
    int n=(int)strlen(h); if(n&1) return -1;
    for(int i=0;i<n/2;i++){
        int hi=h[2*i],lo=h[2*i+1];
        #define HV(c) ((c)>='0'&&(c)<='9'?(c)-'0':((c)|0x20)>='a'&&((c)|0x20)<='f'?((c)|0x20)-'a'+10:-1)
        int a=HV(hi),b=HV(lo); if(a<0||b<0) return -1; o[i]=(a<<4)|b;
        #undef HV
    }
    return n/2;
}
static void bin2hex(const uint8_t *b,int n,char *o){
    static const char *x="0123456789abcdef";
    for(int i=0;i<n;i++){ o[2*i]=x[b[i]>>4]; o[2*i+1]=x[b[i]&15]; } o[2*n]=0;
}

static const uint8_t LEITING_DES_KEY[8]={'5','4','8','7','1','1','f','d'};

/* ------------------------------- JNI layer ------------------------------- */

/* H(String hex) -> String plaintext : DES/ECB/PKCS5 decrypt */
JNIEXPORT jstring JNICALL
Java_com_leiting_sdk_SocketHelper_H(JNIEnv *env, jobject thiz, jstring in){
    if(!in) return NULL;
    const char *h=(*env)->GetStringUTFChars(env,in,NULL);
    if(!h) return NULL;
    int clen=(int)strlen(h)/2;
    uint8_t *ct=malloc(clen?clen:1), *pt=malloc(clen?clen:1);
    jstring res=NULL;
    if(ct&&pt&&hex2bin(h,ct)==clen&&des_ecb(ct,clen,pt,LEITING_DES_KEY,0)==0){
        int pad=pt[clen-1];
        if(pad>=1&&pad<=8&&pad<=clen){
            int plen=clen-pad;
            char *z=malloc(plen+1); memcpy(z,pt,plen); z[plen]=0;
            res=(*env)->NewStringUTF(env,z); free(z);
        }
    }
    (*env)->ReleaseStringUTFChars(env,in,h); free(ct); free(pt);
    return res;
}

/* G(String plain) -> String hex : DES/ECB/PKCS5 encrypt (inverse of H) */
JNIEXPORT jstring JNICALL
Java_com_leiting_sdk_SocketHelper_G(JNIEnv *env, jobject thiz, jstring in){
    if(!in) return NULL;
    const char *p=(*env)->GetStringUTFChars(env,in,NULL);
    if(!p) return NULL;
    int n=(int)strlen(p), pad=8-(n%8), tot=n+pad;
    uint8_t *buf=malloc(tot), *ct=malloc(tot);
    char *hex=malloc(tot*2+1); jstring res=NULL;
    if(buf&&ct&&hex){
        memcpy(buf,p,n); memset(buf+n,pad,pad);
        if(des_ecb(buf,tot,ct,LEITING_DES_KEY,1)==0){ bin2hex(ct,tot,hex); res=(*env)->NewStringUTF(env,hex); }
    }
    (*env)->ReleaseStringUTFChars(env,in,p); free(buf); free(ct); free(hex);
    return res;
}

/* --- Remaining natives: safe stubs (fill in when a trace proves they're called) ---
 * A/B/C/D : AES-128-CBC, key "#LeitingAESKey#!", iv "LeitingAESIVKEY!"
 * N/O     : AES-128-CBC, key "#LeitingWEBAES#!", iv "LeitingWEBAESIV!"
 * CW/DW   : AES-128,     key "E3LfXBuk68bvhHyt"
 * E/F     : DES,         key "f6c3f2c274be025a"[:8]   (unverified)
 * G1..G5,k,L,I,J,M : per key table in X86-STUBS-PLAN.md
 */
JNIEXPORT jstring JNICALL Java_com_leiting_sdk_SocketHelper_A(JNIEnv*e,jobject t,jstring s){return NULL;}
JNIEXPORT jstring JNICALL Java_com_leiting_sdk_SocketHelper_B(JNIEnv*e,jobject t,jstring s){return NULL;}
JNIEXPORT void    JNICALL Java_com_leiting_sdk_SocketHelper_Run(JNIEnv*e,jobject t){/*socket hook: no-op on emu*/}
JNIEXPORT void    JNICALL Java_com_leiting_sdk_SocketHelper_Release(JNIEnv*e,jobject t){}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved){ return JNI_VERSION_1_6; }
