import crypto from "node:crypto";

/**
 * Signs a mymind API request per their documented scheme:
 * header {alg: "HS256", kid}, claims {method, path, iat, exp = iat+300},
 * base64url (no padding), HMAC-SHA256 over header.payload using the
 * base64-decoded access-key secret as the HMAC key.
 *
 * `path` must be the bare request path (e.g. "/objects"), no query string —
 * the token binds to a specific path+method so a stolen token can't be
 * replayed against a different endpoint.
 */
export function signMymindRequest(method, path) {
  const kid = process.env.MYMIND_KID;
  const secretB64 = process.env.MYMIND_SECRET;
  if (!kid || !secretB64) {
    throw new Error(
      "MYMIND_KID / MYMIND_SECRET are not set. Fill them into .env at the project root."
    );
  }
  const secret = Buffer.from(secretB64, "base64");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 300;

  const header = Buffer.from(JSON.stringify({ alg: "HS256", kid })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ method: method.toUpperCase(), path, iat, exp })
  ).toString("base64url");

  const data = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");

  return `${data}.${signature}`;
}
