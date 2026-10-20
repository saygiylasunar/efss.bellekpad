const MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function createImageMessage({ prompt, images } = {}) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100000 ||
      !Array.isArray(images) || !images.length || images.length > 4) {
    throw new TypeError("Invalid vision message");
  }
  const content = [{ type: "text", text: prompt }];
  for (const image of images) {
    if (!image || !MIMES.has(image.mimeType) ||
        typeof image.base64 !== "string" || image.base64.length > 8 * 1024 * 1024 ||
        !BASE64.test(image.base64)) throw new TypeError("Invalid image payload");
    content.push({ type: "image_url", image_url: {
      url: "data:" + image.mimeType + ";base64," + image.base64
    } });
  }
  return { role: "user", content };
}
