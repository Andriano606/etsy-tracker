// UI harness samples for feature "account" ("Мій магазин → Акаунт").
// document.documentElement.dataset.uih = 'error' | 'limited' (a sign-in without email/address permissions).

const mode = () => globalThis.document?.documentElement?.dataset?.uih ?? ''

module.exports = {
  summary: async (_a, { own }) => {
    if (mode() === 'error') return { ok: false, error: 'Вхід в Etsy закінчився — увійдіть ще раз у «Мій магазин».' }
    const base = {
      userId: 1002345678,
      email: 'tidyfox.sheets@example.com',
      firstName: 'Андрій',
      lastName: 'Кулуєв',
      avatarUrl: null,
      addresses: [
        { id: 1, name: 'Андрій Кулуєв', firstLine: 'вул. Городоцька, 15, кв. 7', secondLine: null, city: 'Львів', state: 'Львівська обл.', zip: '79007', countryIso: 'UA', countryName: 'Ukraine', isDefaultShipping: true },
        { id: 2, name: 'TidyFox office', firstLine: 'вул. Шевченка, 120', secondLine: 'офіс 304', city: 'Київ', state: null, zip: '01001', countryIso: 'UA', countryName: 'Ukraine', isDefaultShipping: false }
      ],
      grantedScopes: ['listings_r', 'listings_w', 'listings_d', 'shops_r', 'shops_w', 'transactions_r', 'transactions_w', 'email_r', 'address_r'],
      shopId: own.id,
      shopName: own.shopName,
      notes: []
    }
    if (mode() === 'limited')
      return {
        ...base,
        email: null,
        addresses: null,
        grantedScopes: ['listings_r', 'listings_w', 'shops_r'],
        notes: ['Немає дозволу на email акаунта — увійдіть в Etsy ще раз, щоб його надати.', 'Немає дозволу на адреси акаунта — увійдіть в Etsy ще раз, щоб його надати.']
      }
    return base
  }
}
