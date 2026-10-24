import type { GlossaryEntries } from './types'

// Glossary entries of the "settings" area (Settings + the MCP window). Keys start
// with "settings."; plain-Ukrainian, short ≤ 140 chars. See docs/design.md → "Glossary".
// Shared concepts (API key, keystring, VAT, buyer country, MinIO, MCP, port, token…) live in core.ts.
export const SETTINGS = {
  'settings.keyEncrypted': {
    term: 'Шифрування ключа',
    short: 'Ключ зашифровано сховищем паролів вашої системи, тож інші програми не прочитають його з файлу налаштувань.'
  },
  'settings.etsyApproval': {
    term: 'Схвалення застосунку',
    short: 'Після реєстрації Etsy вручну перевіряє ваш застосунок. Поки його не схвалили, ключ не працює.'
  },
  'settings.countryCode': {
    term: 'Код країни',
    short: 'Міжнародне позначення країни з двох латинських літер. Наприклад, Японія — «JP», Норвегія — «NO», Швейцарія — «CH».'
  },
  'settings.storageAddress': {
    term: 'Адреса сховища',
    short: 'Де на цьому комп’ютері працює сховище фото. Якщо ви запускали його за інструкцією, залиште як є.'
  },
  'settings.minioAccessKey': {
    term: 'Логін сховища',
    short: 'Ім’я користувача сховища фото. У налаштуваннях MinIO це поле називається «Access key».'
  },
  'settings.minioSecretKey': {
    term: 'Пароль сховища',
    short: 'Пароль до сховища фото (у MinIO — «Secret key»). Програма зберігає його зашифрованим, якщо система це дозволяє.'
  },
  'settings.minioBucket': {
    term: 'Тека для фото',
    short: 'Тека всередині сховища, куди програма складає фото. У MinIO її називають «bucket». Програма створить її сама.'
  },
  'settings.docker': {
    term: 'Docker',
    short: 'Безкоштовна програма, що запускає інші програми, як-от сховище фото, в окремих «контейнерах». Її треба один раз встановити.',
    long: 'Встановлення описано на сайті docker.com. Після цього сховище запускається однією командою і далі стартує саме разом із комп’ютером.'
  },
  'settings.terminal': {
    term: 'Термінал',
    short: 'Вікно для текстових команд. Відкривається клавішами «Ctrl+Alt+T» або з меню програм.'
  },
  'settings.claudeApp': {
    term: 'Програма Claude',
    short: 'Де ви користуєтесь Claude: у терміналі («Claude Code») чи в окремій програмі для комп’ютера («Claude Desktop»).'
  },
  'settings.mcpWrites': {
    term: 'Зміни магазину через Claude',
    short: 'Claude зможе створювати й редагувати товари у вашому власному магазині. Без цього дозволу він лише читає дані.',
    long: 'Чужі магазини Claude ніколи не змінює. Публікація товару на Etsy платна ($0,20), тому Claude робить її лише на ваше прохання.'
  },
  'settings.mcpTools': {
    term: 'Інструменти Claude',
    short: 'Дії, які Claude може виконати через програму: знайти товар, показати відгуки, статистику тощо. Він сам вибирає потрібну.'
  }
} satisfies GlossaryEntries
