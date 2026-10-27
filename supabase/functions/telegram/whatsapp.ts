// Ответ менеджера клиенту в WhatsApp: какой файл из Telegram и каким типом можно отправить,
// и почему WhatsApp не принял ответ (код ошибки Cloud API → понятное объяснение).
// Без обращений к сети и базе.

/** Коды ошибок WhatsApp Cloud API, которые менеджер может исправить сам. */
const PROBLEMS: Record<number, string> = {
  // Прошло больше 24 часов с последнего сообщения клиента
  131047: "С последнего сообщения клиента прошло больше 24 часов: WhatsApp не даёт писать первым. Позвоните клиенту или дождитесь его сообщения.",
  // Тестовый номер Meta пишет только на номера из списка разрешённых
  131030: "Номер клиента не в списке разрешённых получателей тестового номера Meta. Добавьте его в приложении Meta: WhatsApp → API Setup → To.",
  131026: "Сообщение не доставлено: у клиента нет WhatsApp, старая версия приложения или он не принял условия WhatsApp.",
  131056: "Слишком много сообщений этому клиенту подряд. Подождите немного.",
  130429: "WhatsApp временно ограничил отправку. Попробуйте через минуту.",
  // Токен Meta недействителен
  190: "Доступ к Meta истёк. Переподключите Meta в LightLeads: Настройки → Подключения.",
  // Нет права whatsapp_business_messaging
  10: "У LightLeads нет права отправлять сообщения WhatsApp. Нажмите «Разрешить доступ» в Настройки → Источники лидов → WhatsApp.",
  200: "У LightLeads нет права отправлять сообщения WhatsApp. Нажмите «Разрешить доступ» в Настройки → Источники лидов → WhatsApp.",
  133010: "Номер компании не зарегистрирован в WhatsApp Cloud API. Проверьте его статус в WhatsApp Manager.",
};
const MAX_DETAIL_LENGTH = 200;

export function whatsappProblem(code: number, message: string): string {
  return PROBLEMS[code] ?? `WhatsApp ответил: ${message.slice(0, MAX_DETAIL_LENGTH)}`;
}

const MB = 1024 * 1024;
/** Больше этого Telegram не отдаёт ботам файлы. */
const BOT_DOWNLOAD_LIMIT = 20 * MB;
/** Подпись к файлу в WhatsApp. */
export const MAX_WHATSAPP_CAPTION = 1024;

export type WhatsAppType = "image" | "video" | "audio" | "document";

/** Что WhatsApp принимает каждым типом; остальное уходит документом (до 100 МБ, любого формата). */
const ACCEPTS: Record<Exclude<WhatsAppType, "document">, { maxBytes: number; types: string[] }> = {
  image: { maxBytes: 5 * MB, types: ["image/jpeg", "image/png"] },
  video: { maxBytes: 16 * MB, types: ["video/mp4", "video/3gpp"] },
  audio: { maxBytes: 16 * MB, types: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"] },
};

export const NOTHING_TO_SEND = "Клиенту в WhatsApp можно отправить текст, фото, видео, голосовое, аудио или файл.";
const STICKER = "Стикеры в WhatsApp не отправляются. Отправьте текст, фото или файл.";
const TOO_BIG = "Файл больше 20 МБ: Telegram не даёт боту его скачать. Отправьте файл поменьше или ссылку на него.";

interface TgFile {
  file_id: string;
  file_size?: number;
  mime_type?: string;
  file_name?: string;
}

/** Вложения сообщения Telegram, которые бот может переслать. */
export interface TgAttachments {
  photo?: TgFile[];
  video?: TgFile;
  video_note?: TgFile;
  animation?: TgFile;
  voice?: TgFile;
  audio?: TgFile;
  document?: TgFile;
  sticker?: TgFile;
}

export interface ManagerMedia {
  fileId: string;
  type: WhatsAppType;
  mimeType: string;
  filename: string;
}

/** Файл из ответа менеджера и тип сообщения WhatsApp для него. null — файла нет, problem — отправить нельзя. */
export function managerMedia(message: TgAttachments): ManagerMedia | { problem: string } | null {
  if (message.sticker) return { problem: STICKER };
  const photo = message.photo?.at(-1);
  const video = message.video ?? message.video_note ?? message.animation;
  const audio = message.voice ?? message.audio;
  const file = photo ?? video ?? audio ?? message.document;
  if (!file) return null;
  if (Number(file.file_size ?? 0) > BOT_DOWNLOAD_LIMIT) return { problem: TOO_BIG };

  // Фото Telegram всегда JPEG, голосовые — OGG, кружки — MP4
  const mimeType = file.mime_type || (photo ? "image/jpeg" : message.voice ? "audio/ogg" : video ? "video/mp4" : "application/octet-stream");
  const wanted: WhatsAppType = photo ? "image" : video ? "video" : audio ? "audio" : "document";
  const limits = wanted === "document" ? null : ACCEPTS[wanted];
  const fits = !limits || (limits.types.includes(mimeType.split(";")[0]) && Number(file.file_size ?? 0) <= limits.maxBytes);
  const extension = mimeType.split(";")[0].split("/")[1] || "bin";
  return {
    fileId: file.file_id,
    type: fits ? wanted : "document",
    mimeType,
    filename: file.file_name || `${message.voice ? "voice" : wanted === "image" ? "photo" : wanted === "document" ? "file" : wanted}.${extension}`,
  };
}
