import {
  scryptSync,
  scrypt,
  randomBytes,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64),
    expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function key() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[a-f0-9]{64}$/i.test(hex))
    throw Error("ENCRYPTION_KEY must be 32 random bytes in hex");
  return Buffer.from(hex, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64"))
    .join(".");
}
export function decrypt(ciphertext: string) {
  const [iv, tag, data] = ciphertext
    .split(".")
    .map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
  );
}
export const dummyHash = hashPassword("not-a-valid-account-password");
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(key)));
export async function hashPasswordAsync(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(password,salt)).toString('hex');}
export async function verifyPasswordAsync(password:string,encoded:string){if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(encoded))return false;const [salt,hash]=encoded.split(':');return timingSafeEqual(await derive(password,salt),Buffer.from(hash,'hex'));}
