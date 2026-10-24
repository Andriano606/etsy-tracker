import { Term } from '../ui'
import { ExternalLink } from './ExternalLink'

/**
 * How to get an Etsy API key, step by step for someone who has never seen
 * Etsy's developer pages — shown on the first-run screen and in Settings.
 * `withPasteStep` (default true) adds the last step "paste it in Settings";
 * the first-run screen has that as a step of its own.
 */
export function KeyHelp({ withPasteStep = true }: { withPasteStep?: boolean } = {}): JSX.Element {
  return (
    <ol className="key-help">
      <li>
        Відкрийте <Term glossary="shell.developerSite">сайт для розробників Etsy</Term> і увійдіть своїм звичайним
        акаунтом Etsy:{' '}
        <ExternalLink href="https://www.etsy.com/developers/register" icon>
          etsy.com/developers/register
        </ExternalLink>
      </li>
      <li>
        Зареєструйте застосунок: впишіть будь-яку назву й короткий опис, а тип оберіть{' '}
        <Term glossary="shell.personalApp">Personal App</Term> (особистий).
      </li>
      <li>
        Дочекайтеся <Term glossary="settings.etsyApproval">схвалення</Term>: Etsy перевіряє нові застосунки вручну (від
        кількох годин до кількох днів), і до того ключ не працює.
      </li>
      <li>
        Відкрийте{' '}
        <ExternalLink href="https://www.etsy.com/developers/your-apps" icon>
          Your Apps
        </ExternalLink>{' '}
        (ваші застосунки), натисніть значок ока й скопіюйте дві частини ключа:{' '}
        <Term glossary="keystring">Keystring</Term> і <Term glossary="sharedSecret">Shared secret</Term>.
      </li>
      {withPasteStep && <li>Вставте обидві частини в Налаштуваннях і натисніть «Перевірити ключ».</li>}
    </ol>
  )
}
