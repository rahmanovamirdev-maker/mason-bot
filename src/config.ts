import dotenv from "dotenv";

dotenv.config();

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }

  return value;
}

const ownerTelegramId = Number(readRequiredEnv("OWNER_TELEGRAM_ID"));

if (Number.isNaN(ownerTelegramId)) {
  throw new Error("OWNER_TELEGRAM_ID must be a valid number");
}

export const config = {
  botToken: readRequiredEnv("BOT_TOKEN"),
  ownerTelegramId
};
