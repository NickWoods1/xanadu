# Test on a Pixel 7 Pro

## Enable USB installation

1. On the Pixel, open **Settings > About phone**.
2. Tap **Build number** seven times and enter the device PIN.
3. Open **Settings > System > Developer options**.
4. Enable **USB debugging**.
5. Connect the phone over USB and approve the computer's debugging key on the phone.

## Install from Android Studio

1. Open the repository's `android` directory in Android Studio.
2. Run the app once, then enter the Worker URL and app token in its connection settings.
3. Select the Pixel 7 Pro in the device selector.
4. Run the `app` configuration.

## Install a command-line build

Install the prepared APK with:

```sh
adb install -r Xanadu-debug.apk
```

Or, after running `./gradlew assembleDebug` inside `android`, install with:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The application asks only for network access. It does not connect to the ring over
Bluetooth; the official Pebble app continues to own that connection.

## First end-to-end test

1. Open Pebble Notes.
2. Tap `+` and submit: `Remember to order coffee filters`.
3. It should appear in `All` and `TODO`.
4. Configure the Pebble webhook.
5. Record: `The word petrichor means the smell after rain`.
6. Refresh Pebble Notes; it should appear under `Words`.
