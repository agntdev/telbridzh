import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  adminChatId,
  inlineButton,
  inlineKeyboard,
  registerMainMenuItem,
  requireOwner,
} from "../toolkit/index.js";
import {
  listRelayAttempts,
  recordRelayAttempt,
  type RelayAttempt,
  type WorkerEnv,
} from "../toolkit/session/durable.js";

registerMainMenuItem({ label: "Отправить по номеру", data: "send:start", order: 10 });
registerMainMenuItem({ label: "Управление", data: "relay:admin", order: 90 });

const composer = new Composer<Ctx>();
const PHONE = /^\+[1-9]\d{7,14}$/;
const MAX_MESSAGE_LENGTH = 4000;
const FLOW_TTL_MS = 15 * 60 * 1000;
let clock: () => number = () => Date.now();
/** Injectable clock seam for deterministic expiry checks. */
export function setRelayClock(nextClock: () => number): void {
  clock = nextClock;
}
const cancelKeyboard = inlineKeyboard([[inlineButton("Отмена", "send:cancel")]]);
const backKeyboard = inlineKeyboard([[inlineButton("В меню", "menu:main")]]);
type EnvCtx = Ctx & { env?: WorkerEnv };

function clearFlow(ctx: Ctx): void {
  ctx.session.relayStep = undefined;
  ctx.session.relayPhone = undefined;
  ctx.session.relayStartedAt = undefined;
}

function phonePrompt() {
  return { force_reply: true as const, input_field_placeholder: "+79991234567", selective: true };
}

function textPrompt() {
  return { force_reply: true as const, input_field_placeholder: "Введите сообщение", selective: true };
}

composer.callbackQuery("send:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearFlow(ctx);
  ctx.session.relayStep = "phone";
  ctx.session.relayStartedAt = clock();
  await ctx.reply("Введите номер получателя в формате +79991234567.", { reply_markup: phonePrompt() });
});

composer.callbackQuery("send:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearFlow(ctx);
  await ctx.editMessageText("Отправка отменена.", { reply_markup: backKeyboard });
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.relayStep === undefined) return next();
  if (ctx.session.relayStartedAt !== undefined && clock() - ctx.session.relayStartedAt > FLOW_TTL_MS) {
    clearFlow(ctx);
    await ctx.reply("Время на отправку истекло. Начните заново через меню.", { reply_markup: backKeyboard });
    return;
  }
  const value = ctx.message.text.trim();

  if (ctx.session.relayStep === "phone") {
    if (!PHONE.test(value)) {
      await ctx.reply("Номер не подходит. Укажите его в формате +79991234567.", { reply_markup: cancelKeyboard });
      return;
    }
    ctx.session.relayPhone = value;
    ctx.session.relayStep = "message";
    await ctx.reply("Введите текст сообщения.", { reply_markup: textPrompt() });
    return;
  }

  if (value.length === 0) {
    await ctx.reply("Текст сообщения пустой. Введите текст или отмените отправку.", { reply_markup: cancelKeyboard });
    return;
  }
  if (value.length > MAX_MESSAGE_LENGTH) {
    await ctx.reply("Сообщение слишком длинное. Сократите его до 4000 символов.", { reply_markup: cancelKeyboard });
    return;
  }

  const attempt: RelayAttempt = {
    timestamp: clock(),
    senderId: ctx.from.id,
    targetPhone: ctx.session.relayPhone!,
    messageText: value,
    deliveryResult: "UNSUPPORTED_PHONE_LOOKUP",
  };
  const stored = await recordRelayAttempt((ctx as EnvCtx).env, attempt);
  clearFlow(ctx);

  await ctx.reply(
    "Доставка не выполнена. Код: UNSUPPORTED_PHONE_LOOKUP.\n" +
      "Telegram Bot API не позволяет найти получателя только по номеру телефона.",
    { reply_markup: backKeyboard },
  );

  const owner = adminChatId({ env: (ctx as EnvCtx).env as unknown as Record<string, unknown> | undefined });
  if (owner) {
    try {
      await ctx.api.sendMessage(owner, "Не доставлено сообщение по номеру. Код: UNSUPPORTED_PHONE_LOOKUP.");
    } catch {
      // A blocked owner cannot prevent the sender from receiving their result.
    }
  }
  if (!stored) {
    await ctx.reply("Журнал попытки сейчас недоступен. Повторите отправку позже.");
  }
});

composer.callbackQuery("relay:admin", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Выберите действие.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Журнал попыток", "relay:logs")],
      [inlineButton("Язык интерфейса", "relay:lang")],
      [inlineButton("В меню", "menu:main")],
    ]),
  });
});

composer.callbackQuery("relay:lang", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Язык интерфейса: русский.", { reply_markup: backKeyboard });
});

composer.callbackQuery("relay:logs", async (ctx) => {
  if (!(await requireOwner(ctx))) return;
  await ctx.answerCallbackQuery();
  const attempts = await listRelayAttempts((ctx as EnvCtx).env);
  if (attempts === undefined) {
    await ctx.editMessageText("Журнал попыток пока недоступен.", { reply_markup: backKeyboard });
    return;
  }
  if (attempts.length === 0) {
    await ctx.editMessageText("Попыток доставки пока нет.", { reply_markup: backKeyboard });
    return;
  }
  const lines = attempts.map((attempt) => `${attempt.targetPhone} — ${attempt.deliveryResult}`);
  await ctx.editMessageText(`Последние попытки:\n${lines.join("\n")}`, { reply_markup: backKeyboard });
});

export default composer;
