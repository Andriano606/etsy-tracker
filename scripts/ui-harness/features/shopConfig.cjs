// UI harness samples for feature "shopConfig" (Мій магазин → Розділи / Доставка /
// Обробка / Повернення / Свята / Партнери, own listing → Розділ магазину).
// Shapes = src/shared/features/shopConfig.ts. Writes answer as if Etsy accepted them.

const usd = (v) => ({ amount: Math.round(v * 100), divisor: 100, currency: 'USD' })

const sections = [
  { id: 41001, title: 'Бюджет і фінанси', rank: 1, activeListingCount: 14 },
  { id: 41002, title: 'Планери на тиждень і місяць — для дому, роботи та навчання', rank: 2, activeListingCount: 9 },
  { id: 41003, title: 'Малий бізнес', rank: 3, activeListingCount: 6 },
  { id: 41004, title: 'Подарункові набори', rank: 4, activeListingCount: 0 }
]

const dest = (id, profileId, over) => ({
  id,
  profileId,
  originCountry: 'UA',
  destinationCountry: null,
  destinationRegion: 'none',
  primaryCost: usd(6),
  secondaryCost: usd(2),
  carrierId: null,
  mailClass: null,
  minDeliveryDays: 10,
  maxDeliveryDays: 21,
  ...over
})

const destinations = {
  51001: [
    dest(61001, 51001, { destinationCountry: 'US', primaryCost: usd(8.5), secondaryCost: usd(2.5), minDeliveryDays: 10, maxDeliveryDays: 18 }),
    dest(61002, 51001, { destinationRegion: 'eu', primaryCost: usd(6), secondaryCost: usd(1.5), carrierId: 7, mailClass: 'ukr_intl_standard', minDeliveryDays: null, maxDeliveryDays: null }),
    dest(61003, 51001, { destinationCountry: 'GB', primaryCost: usd(7), secondaryCost: usd(2), minDeliveryDays: 7, maxDeliveryDays: 14 }),
    dest(61004, 51001, { destinationRegion: 'none', primaryCost: usd(12), secondaryCost: usd(4), minDeliveryDays: 14, maxDeliveryDays: 30 })
  ],
  51002: [dest(61010, 51002, { destinationCountry: 'UA', primaryCost: usd(2), secondaryCost: usd(0.5), minDeliveryDays: 1, maxDeliveryDays: 3 })]
}

const upgrades = {
  51001: [
    {
      id: 71001,
      profileId: 51001,
      name: 'Експрес-доставка (DHL)',
      international: true,
      rank: 0,
      language: 'uk',
      price: usd(15),
      secondaryPrice: usd(3),
      carrierId: 9,
      mailClass: 'dhl_express',
      minDeliveryDays: null,
      maxDeliveryDays: null
    },
    {
      id: 71002,
      profileId: 51001,
      name: 'Пріоритетна',
      international: false,
      rank: 1,
      language: 'uk',
      price: usd(3),
      secondaryPrice: usd(1),
      carrierId: null,
      mailClass: null,
      minDeliveryDays: 1,
      maxDeliveryDays: 2
    }
  ],
  51002: []
}

const profiles = [
  {
    id: 51001,
    title: 'Друковані планери — міжнародна доставка',
    originCountry: 'UA',
    originPostalCode: '79000',
    isDeleted: false,
    profileType: 'manual',
    domesticHandlingFee: 0,
    internationalHandlingFee: 0
  },
  {
    id: 51002,
    title: 'По Україні',
    originCountry: 'UA',
    originPostalCode: '79000',
    isDeleted: false,
    profileType: 'manual',
    domesticHandlingFee: 0,
    internationalHandlingFee: 0
  }
].map((p) => ({ ...p, destinations: destinations[p.id] ?? [], upgrades: upgrades[p.id] ?? [] }))

const carriers = [
  {
    id: 7,
    name: 'Укрпошта',
    domesticClasses: [
      { key: 'ukr_standard', name: 'Стандарт' },
      { key: 'ukr_express', name: 'Експрес' }
    ],
    internationalClasses: [
      { key: 'ukr_intl_standard', name: 'Міжнародна стандарт' },
      { key: 'ukr_intl_priority', name: 'Міжнародна пріоритет' }
    ]
  },
  { id: 8, name: 'Нова пошта', domesticClasses: [{ key: 'np_warehouse', name: 'До відділення' }], internationalClasses: [{ key: 'np_intl', name: 'Міжнародна' }] },
  { id: 9, name: 'DHL', domesticClasses: [], internationalClasses: [{ key: 'dhl_express', name: 'Express Worldwide' }] }
]

const processing = [
  { id: 81001, readinessState: 'ready_to_ship', minDays: 1, maxDays: 2, label: '1-2 business days' },
  { id: 81002, readinessState: 'made_to_order', minDays: 3, maxDays: 5, label: '3-5 business days' },
  { id: 81003, readinessState: 'made_to_order', minDays: 14, maxDays: 21, label: '2-3 weeks' }
]

const policies = [
  { id: 91001, acceptsReturns: true, acceptsExchanges: true, returnDeadline: 30 },
  { id: 91002, acceptsReturns: false, acceptsExchanges: true, returnDeadline: 14 },
  { id: 91003, acceptsReturns: false, acceptsExchanges: false, returnDeadline: null }
]

const holidays = [
  { holidayId: 1, countryIso: 'US', name: 'New Year’s Day', isWorking: false },
  { holidayId: 5, countryIso: 'US', name: 'Memorial Day', isWorking: true },
  { holidayId: 7, countryIso: 'US', name: 'Independence Day', isWorking: false },
  { holidayId: 11, countryIso: 'US', name: 'Thanksgiving Day', isWorking: false },
  { holidayId: 12, countryIso: 'US', name: 'Christmas Day', isWorking: false }
]

const byId = (list, id) => list.find((x) => x.id === Number(id))

module.exports = {
  sections: () => sections,
  createSection: (a) => ({ id: 41099, title: a.input?.title ?? 'Новий', rank: 9, activeListingCount: 0 }),
  updateSection: (a) => ({ ...byId(sections, a.sectionId), ...a.input }),
  deleteSection: () => null,
  listingSection: () => ({ sections, sectionId: 41001, known: true }),
  setListingSection: (a, ctx) => ({ ...(ctx.myListings.find((l) => l.listingId === a.listingId) ?? ctx.myListings[0]) }),

  shippingProfiles: () => profiles,
  shippingProfile: (a) => byId(profiles, a.profileId) ?? profiles[0],
  destinations: (a) => destinations[a.profileId] ?? [],
  upgrades: (a) => upgrades[a.profileId] ?? [],
  carriers: () => carriers,
  createShippingProfile: (a) => ({ ...profiles[0], id: 51099, title: a.input?.title ?? 'Новий профіль' }),
  updateShippingProfile: (a) => ({ ...(byId(profiles, a.profileId) ?? profiles[0]), ...(a.input?.title ? { title: a.input.title } : {}) }),
  deleteShippingProfile: () => null,
  createDestination: (a) => dest(61099, a.profileId, {}),
  updateDestination: (a) => (destinations[a.profileId] ?? []).find((d) => d.id === a.destinationId) ?? dest(a.destinationId, a.profileId, {}),
  deleteDestination: () => null,
  createUpgrade: (a) => ({ ...upgrades[51001][0], id: 71099, profileId: a.profileId }),
  updateUpgrade: (a) => (upgrades[a.profileId] ?? []).find((u) => u.id === a.upgradeId) ?? upgrades[51001][0],
  deleteUpgrade: () => null,

  processingProfiles: () => processing,
  createProcessingProfile: () => ({ ...processing[0], id: 81099 }),
  updateProcessingProfile: (a) => byId(processing, a.id) ?? processing[0],
  deleteProcessingProfile: () => ({ ok: false, error: 'Etsy не дозволяє видалити профіль, який використовують активні товари.' }),

  returnPolicies: () => policies,
  returnPolicyListings: (a, ctx) =>
    a.id === 91003 ? [] : ctx.myListings.slice(0, a.id === 91001 ? 6 : 2).map((l) => ({ listingId: l.listingId, title: l.title, state: l.state })),
  createReturnPolicy: (a) => ({ id: 91099, acceptsReturns: !!a.input?.accepts_returns, acceptsExchanges: !!a.input?.accepts_exchanges, returnDeadline: Number(a.input?.return_deadline) || null }),
  updateReturnPolicy: (a) => ({ ...byId(policies, a.id), acceptsReturns: !!a.input?.accepts_returns, acceptsExchanges: !!a.input?.accepts_exchanges }),
  deleteReturnPolicy: () => null,
  consolidateReturnPolicies: (a) => byId(policies, a.destinationId),

  holidays: () => holidays,
  setHoliday: (a) => ({ ...holidays.find((h) => h.holidayId === a.holidayId), isWorking: !!a.isWorking }),
  partners: () => [
    { id: 1, name: 'Друкарня «Галицька поліграфія»', location: 'Львів, Україна' },
    { id: 2, name: 'Палітурна майстерня Олени К.', location: 'Винники, Україна' }
  ]
}
