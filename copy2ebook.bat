@echo off
xcopy "C:\Users\tanaka\git\pdf.js4ebook\build\generic\web\viewer.js" "C:\Users\tanaka\git\EBook\EBook\WebContent\web\" /Y
xcopy "C:\Users\tanaka\git\pdf.js4ebook\build\generic\web\viewer.js.map" "C:\Users\tanaka\git\EBook\EBook\WebContent\web\" /Y
xcopy "C:\Users\tanaka\git\pdf.js4ebook\build\generic\web\debugger.js" "C:\Users\tanaka\git\EBook\EBook\WebContent\web\" /Y
xcopy "C:\Users\tanaka\git\pdf.js4ebook\build\generic\web\debugger.css" "C:\Users\tanaka\git\EBook\EBook\WebContent\web\" /Y

xcopy "C:\Users\tanaka\git\pdf.js4ebook\build\generic\build\*.*" "C:\Users\tanaka\git\EBook\EBook\WebContent\build\" /Y
echo Files copied successfully!
pause