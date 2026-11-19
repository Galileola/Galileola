import en from './en';
import ru from './ru';
import et from './et';
import chatEn from './dialogues/en';
import chatRu from './dialogues/ru';
import chatEt from './dialogues/et';

// Adds each lesson's role-play (who you talk to, what they say) and the chat copy.
const withChat = (lang, chat) => ({
  ...lang,
  ui: { ...lang.ui, chat: chat.ui },
  modules: lang.modules.map((m) => ({ ...m, lessons: m.lessons.map((l) => ({ ...l, chat: chat.lessons[l.id] })) })),
});

export const LANG_ORDER = ['en', 'ru', 'et'];
export default { en: withChat(en, chatEn), ru: withChat(ru, chatRu), et: withChat(et, chatEt) };
