import crypto from "crypto"

function getSecretKey(explicitKey?: string): string {
  const key = explicitKey || process.env.RDP_ENCRYPTION_KEY || process.env.JWT_SECRET || "vm-console-default-secret-fallback-key";
  return key;
}

export interface DecryptedRDPPayload {
  url?: string
  port?: string
  user?: string
  password?: string
  vmName?: string
  consoleType?: string
  exp?: number
  iat?: number
  jti?: string
}

export function encryptPayload(payload: object, secretKeyStr?: string): string {
  const effectiveKey = getSecretKey(secretKeyStr);
  const key = crypto.createHash("sha256").update(effectiveKey).digest()

  const iv = crypto.randomBytes(12)
  const now = Math.floor(Date.now() / 1000)
  const iat = (payload as DecryptedRDPPayload).iat || now
  const jti = (payload as DecryptedRDPPayload).jti || crypto.randomUUID()
  // Short-lived 60s token for secure handshake
  const exp = (payload as DecryptedRDPPayload).exp || (now + 60)
  const jsonStr = JSON.stringify({ ...payload, jti, iat, exp })

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(jsonStr, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`
}

export function decryptPayload(encryptedData: string, secretKeyStr?: string): DecryptedRDPPayload {
  const effectiveKey = getSecretKey(secretKeyStr);
  const parts = encryptedData.split(":")
  if (parts.length !== 3) {
    throw new Error("Invalid token format")
  }

  const iv = Buffer.from(parts[0], "hex")
  const authTag = Buffer.from(parts[1], "hex")
  const encrypted = Buffer.from(parts[2], "hex")

  const key = crypto.createHash("sha256").update(effectiveKey).digest()

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = decipher.update(encrypted) + decipher.final("utf8")
  const parsed = JSON.parse(decrypted) as DecryptedRDPPayload

  const now = Math.floor(Date.now() / 1000)
  if (parsed.exp && now > parsed.exp) {
    throw new Error("Session token has expired")
  }

  return parsed
}
