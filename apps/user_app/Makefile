ADB := $(HOME)/Library/Android/sdk/platform-tools/adb

.PHONY: devices wake start build install run-apk

devices:
	$(ADB) devices

wake:
	$(ADB) shell input keyevent KEYCODE_WAKEUP
	$(ADB) shell input swipe 500 1900 500 600 400

start:
	$(ADB) shell am start -n com.example.tapgo_user_app/.MainActivity

build:
	flutter build apk --debug

install:
	$(ADB) install -r build/app/outputs/flutter-apk/app-debug.apk

run-apk: build install start
