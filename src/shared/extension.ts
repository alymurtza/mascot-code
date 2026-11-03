/** The browser extension and the app's native messaging host, which must agree on these. */

/** The host's name, as the extension asks for it. */
export const NATIVE_HOST = 'com.mascot.downloader'

/** Chrome, Edge and Brave extension IDs allowed to use the host: the one built here (its key is
 * in its manifest), then each store's. */
export const EXTENSION_IDS = [
  'jkjflpeecjefphglhhidnmmgklhkicja',
  // Chrome Web Store
  'jdbajgaajkoafbdfgnldbfmloclfgnjg'
]

/** The extension's Chrome Web Store page (Chrome, Brave and Edge install from it). */
export const EXTENSION_STORE_URL =
  'https://chromewebstore.google.com/detail/jdbajgaajkoafbdfgnldbfmloclfgnjg'

/** Firefox's ID for the extension. */
export const FIREFOX_ID = 'downloader@mascot.app'
