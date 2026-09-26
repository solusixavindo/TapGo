# tflite_flutter referensi delegasi GPU opsional yang tidak disertakan (pemeriksaan
# wajah memakai interpreter CPU). Tanpa aturan ini R8 gagal pada build rilis:
# "Missing class org.tensorflow.lite.gpu.GpuDelegateFactory$Options".
-dontwarn org.tensorflow.lite.gpu.GpuDelegateFactory$Options
