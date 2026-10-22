import { ExternalLink } from './ExternalLink'

/** How to get an Etsy API key — shown on the first-run screen and in Settings. */
export function KeyHelp(): JSX.Element {
  return (
    <ol className="key-help">
      <li>
        Увійдіть на Etsy та зареєструйте застосунок:{' '}
        <ExternalLink href="https://www.etsy.com/developers/register">
          etsy.com/developers/register
        </ExternalLink>
        . Для відстеження чужих магазинів обирайте <b>Personal App</b>.
      </li>
      <li>
        Відкрийте{' '}
        <ExternalLink href="https://www.etsy.com/developers/your-apps">Your Apps</ExternalLink>,
        натисніть на іконку ока й скопіюйте <b>Keystring</b> та <b>Shared secret</b>.
      </li>
      <li>
        Ключ запрацює лише після схвалення застосунку Etsy (Personal App проходить ручну
        перевірку).
      </li>
      <li>
        Вставте обидва значення в Налаштуваннях і натисніть «Перевірити ключ».
      </li>
    </ol>
  )
}
