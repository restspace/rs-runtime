const bytes = crypto.getRandomValues(new Uint8Array(32));
const secret = btoa(String.fromCharCode(...bytes))
  .replace(/=/g, "")
  .toUpperCase();

console.log(secret);
