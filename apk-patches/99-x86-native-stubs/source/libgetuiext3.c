#include <jni.h>
#include <stddef.h>
JNIEXPORT void* JNICALL Java_com_igexin_dms_core_NativeCaller_doDaemon(JNIEnv* e, jobject t){ (void)e; (void)t; return NULL; }
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* v, void* r){ (void)v; (void)r; return JNI_VERSION_1_6; }
