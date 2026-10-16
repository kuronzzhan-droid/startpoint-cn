#include <jni.h>
#include <stddef.h>
JNIEXPORT void* JNICALL Java_com_netease_LDNetDiagnoService_LDNetSocket_startJNITelnet(JNIEnv* e, jobject t){ (void)e; (void)t; return NULL; }
JNIEXPORT void* JNICALL Java_com_netease_LDNetDiagnoService_LDNetTraceRoute_startJNICTraceRoute(JNIEnv* e, jobject t){ (void)e; (void)t; return NULL; }
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* v, void* r){ (void)v; (void)r; return JNI_VERSION_1_6; }
