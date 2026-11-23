// Everything this device keeps of this Iridium let go, as the login ends (logged out, or its
// session gone: a 401): the pictures, the chats. At most a second: the page goes on to the login
// after it whatever.
import { forgetFirst } from "./first";

export async function forget() {
  forgetFirst();
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
  } catch {}
  await Promise.race([import("./store").then((m) => m.clear()), new Promise((r) => setTimeout(r, 1000))]).catch(() => {});
}
