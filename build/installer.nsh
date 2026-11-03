; Uninstalling Mascot also removes its registration with the browsers (the native messaging
; host the browser extension uses), so nothing points at the removed app.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.mascot.downloader"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.mascot.downloader"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.mascot.downloader"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.mascot.downloader"
  DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.mascot.downloader"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.mascot.downloader"
!macroend
