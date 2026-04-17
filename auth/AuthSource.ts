import { Message } from "rs-core/Message.ts";

export type AuthSource = "cookie" | "authorization";

const authSourceByMessage = new WeakMap<Message, AuthSource>();

export function setAuthSource(msg: Message, source?: AuthSource) {
    if (source) {
        authSourceByMessage.set(msg, source);
    } else {
        authSourceByMessage.delete(msg);
    }
    return msg;
}

export function getAuthSource(msg: Message): AuthSource | undefined {
    return authSourceByMessage.get(msg);
}
