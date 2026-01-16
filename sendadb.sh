#!/bin/sh

mkdir -p google-photos-sent

for i in google-photos-sent/*; do
    adb push "$i" /sdcard/DCIM/Camera/
    if [ $? -ne 0 ]; then
        echo "Error pushing $i"
        exit 1
    fi
    
    # Rescan the uploaded file
    filename=$(basename "$i")
    adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/Camera/"$filename"
    
    mv "$i" google-photos-anna/
done
