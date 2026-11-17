-- OpenAI API key, encrypted with the same AES-GCM key as the Claude token.
ALTER TABLE users ADD COLUMN codex_key TEXT;
