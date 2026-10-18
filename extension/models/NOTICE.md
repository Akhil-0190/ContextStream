# Model asset notice

`efficientdet_lite0.tflite` is the MediaPipe EfficientDet Lite0 float16 object-detection model, version 1, downloaded from the official Google-hosted MediaPipe model storage:

https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite

The model is distributed for local inference. MediaPipe maintainers state that MediaPipe models and source code are Apache 2.0 unless an asset carries a different notice: https://github.com/google-ai-edge/mediapipe/issues/6355#issuecomment-2340055470

The class vocabulary is fixed (COCO-style categories); this is not an open-vocabulary detector. The model runs in the extension's local Web Worker and does not upload frames.
