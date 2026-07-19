// ── Card benefit data ─────────────────────────────────────────────────────
export const CARDS={
  gold:{name:'AMEX Gold',fee:325,historicalFees:{2024:250,2025:325},feeMonth:4,feeDay:24,sections:[
    {label:'Monthly',cadence:'monthly',benefits:[
      {id:'g_dining',name:'Dining Credit',desc:'Grubhub, Cheesecake Factory, Five Guys, BWW, Wonder',amount:10},
      {id:'g_uber',name:'Uber Cash',desc:'Uber rides or Uber Eats in the US',amount:10},
      {id:'g_dunkin',name:"Dunkin' Credit",desc:"At U.S. Dunkin' locations",amount:7,startsFrom:2025},
    ]},
    {label:'Semi-annual (calendar)',cadence:'cal-semi-annual',benefits:[
      {id:'g_resy',name:'Resy Dining Credit',desc:'Any U.S. Resy restaurant — no reservation required',amount:50,startsFrom:2025,partial:true},
    ]},
  ]},
  platinum:{name:'AMEX Platinum',fee:895,historicalFees:{2025:695},feeMonth:8,feeDay:17,openedYear:2025,sections:[
    {label:'Monthly',cadence:'monthly',benefits:[
      {id:'p_uber',name:'Uber Cash',desc:'$15/mo · $35 in December',amount:15,decAmount:35},
      {id:'p_digital',name:'Digital Entertainment',desc:'Disney+, Hulu, ESPN+, Peacock, Paramount+, NYT, WSJ, YouTube',amount:25},
      {id:'p_walmart',name:'Walmart+ Credit',desc:'Covers monthly Walmart+ membership (incl. tax)',amount:14.07},
    ]},
    {label:'Quarterly',cadence:'quarterly',benefits:[
      {id:'p_resy',name:'Resy Dining Credit',desc:'At eligible U.S. Resy restaurants',amount:100,startsFrom:2025,partial:true},
      {id:'p_lulu',name:'Lululemon Credit',desc:'U.S. stores or lululemon.com',amount:75,startsFrom:2025,partial:true},
    ]},
    {label:'Semi-annual (calendar)',cadence:'cal-semi-annual',benefits:[
      {id:'p_saks',name:'Saks Fifth Avenue',desc:'At Saks stores or saks.com — resets Jan & Jul. Ends Jun 2026.',amount:50,expiresAfter:{y:2026,h:0},partial:true},
      {id:'p_hotel',name:'Hotel Credit',desc:'Fine Hotels + Resorts or Hotel Collection, 2-night min — resets Jan & Jul',amount:300,partial:true},
    ]},
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'p_uberone',name:'Uber One Membership Credit',desc:'One-time credit for annual Uber One membership',amount:96,startsFrom:2025},
      {id:'p_airline',name:'Airline Fee Credit',desc:'Incidental fees with one selected airline',amount:200,partial:true},
      {id:'p_equinox',name:'Equinox Credit',desc:'Equinox club or app membership',amount:300,partial:true},
      {id:'p_oura',name:'Oura Ring Credit',desc:'Hardware only via OURAring.com',amount:200,startsFrom:2025},
      {id:'p_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
      {id:'p_clear',name:'CLEAR Plus Credit',desc:'Annual CLEAR Plus membership',amount:189},
    ]},
  ]},
  cap1_venture_x:{name:'Capital One Venture X',fee:395,historicalFees:{2025:395},feeMonth:0,feeDay:15,sections:[
    {label:'Annual',cadence:'annual',benefits:[
      {id:'vx_travel',name:'Annual Travel Credit',desc:'For bookings through Capital One Travel; resets on card anniversary',amount:300,partial:true},
      {id:'vx_anniv',name:'Anniversary Bonus Miles',desc:'10,000 bonus miles credited on each account anniversary (~$100 in travel value)',amount:100},
      {id:'vx_hotel',name:'Premier Collection Hotel Credit',desc:'Experience credit on eligible 2-night+ stays via Capital One Travel',amount:100,partial:true},
      {id:'vx_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  csr:{name:'Chase Sapphire Reserve',fee:795,historicalFees:{2025:550},feeMonth:4,feeDay:1,sections:[
    {label:'Monthly',cadence:'monthly',benefits:[
      {id:'c_dd_restaurant',name:'DoorDash Restaurant Credit',desc:'$5 promo for restaurant orders (DashPass required)',amount:5},
      {id:'c_dd_nonrest1',name:'DoorDash $10 Grocery Credit',desc:'$10 promo for grocery, convenience, etc',amount:10},
      {id:'c_dd_nonrest2',name:'DoorDash $10 Grocery Credit',desc:'$10 promo for grocery, convenience, etc',amount:10},
      {id:'c_lyft',name:'Lyft Credit',desc:'Monthly in-app credit for rides (through Sep 2027)',amount:10,startsFrom:2025},
      {id:'c_peloton',name:'Peloton Credit',desc:'Toward eligible Peloton memberships',amount:10,startsFrom:2025},
    ]},
    {label:'Semi-annual (calendar)',cadence:'cal-semi-annual',benefits:[
      {id:'c_dining',name:'Exclusive Tables Dining Credit',desc:'Via OpenTable Sapphire Reserve Exclusive Tables',amount:150,startsFrom:2025,partial:true},
      {id:'c_stub',name:'StubHub / Viagogo Credit',desc:'Concert and event tickets',amount:150,startsFrom:2025,partial:true},
      {id:'c_edit1',name:'The Edit Hotel Credit (H1)',desc:'Prepaid 2-night+ stay via Chase Travel The Edit — available Jan–Jun only',amount:250,startsFrom:2026,halfEnd:0},
      {id:'c_edit2',name:'The Edit Hotel Credit (H2)',desc:'Prepaid 2-night+ stay via Chase Travel The Edit — available Jul–Dec only',amount:250,startsFrom:2026,halfStart:1},
    ]},
    {label:'Travel credit (Feb–Jan)',cadence:'feb-annual',benefits:[
      {id:'c_travel',name:'Travel Credit',desc:'Any travel purchase — automatic. Resets each February.',amount:300,partial:true},
    ]},
    {label:'Annual',cadence:'annual',benefits:[
      {id:'c_selecthotel',name:'Select Hotel Credit (2026 only)',desc:'IHG, Montage, Pendry, Omni, Virgin, Minor, Pan Pacific',amount:250,startsFrom:2026},
      {id:'c_apple',name:'Apple TV+ & Apple Music',desc:'Complimentary annual subscriptions — activate once via Chase (through Jun 2027)',amount:288,startsFrom:2026},
      {id:'c_ge',name:'Global Entry / TSA PreCheck / NEXUS',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  chase_sapphire_pref:{name:'Chase Sapphire Preferred',fee:95,historicalFees:{2025:95},feeMonth:0,feeDay:1,sections:[
    {label:'Monthly',cadence:'monthly',benefits:[
      {id:'csp_dashpass',name:'DashPass Promo Credit',desc:'$10/mo for groceries, retail, and more via DoorDash (through Dec 2027)',amount:10,startsFrom:2026},
    ]},
    {label:'Annual',cadence:'annual',benefits:[
      {id:'csp_hotel',name:'Hotel Credit',desc:'Statement credit on hotel stays booked through Chase Travel',amount:100},
      {id:'csp_apple',name:'Apple TV+',desc:'Complimentary annual subscription — activate once via Chase (through Dec 2026)',amount:156,startsFrom:2026},
      {id:'csp_ge',name:'Global Entry / TSA PreCheck / NEXUS',desc:'Statement credit every 4 years',amount:120,startsFrom:2026},
    ]},
  ]},
  amex_green:{name:'AMEX Green',fee:150,historicalFees:{2025:150},feeMonth:0,feeDay:1,sections:[
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'ag_clear',name:'CLEAR Plus Credit',desc:'Annual CLEAR Plus membership',amount:189},
      {id:'ag_lounge',name:'LoungeBuddy Credit',desc:'Airport lounge access via LoungeBuddy app',amount:100,partial:true},
    ]},
  ]},
  amex_hilton_honors:{name:'Hilton Honors Aspire',fee:550,historicalFees:{2025:550},feeMonth:0,feeDay:1,sections:[
    {label:'Semi-annual (calendar)',cadence:'cal-semi-annual',benefits:[
      {id:'ah_resort',name:'Hilton Resort Credit',desc:'At eligible Hilton resort properties worldwide',amount:200,partial:true},
    ]},
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'ah_airline',name:'Airline Fee Credit',desc:'Incidental fees with one selected airline',amount:200,partial:true},
      {id:'ah_freenight',name:'Free Night Award',desc:'One free night at any Hilton property worldwide',amount:250},
      {id:'ah_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  amex_marriott_brill:{name:'Marriott Bonvoy Brilliant',fee:650,historicalFees:{2025:650},feeMonth:0,feeDay:1,sections:[
    {label:'Semi-annual (calendar)',cadence:'cal-semi-annual',benefits:[
      {id:'amb_dining',name:'Dining Credit',desc:'Statement credit for U.S. restaurant purchases',amount:150,partial:true},
    ]},
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'amb_freenight',name:'Free Night Award',desc:'One free night at any Marriott property (up to 85,000 pts)',amount:500},
      {id:'amb_propcredit',name:'Property Credit',desc:'$100 on-property credit on qualifying 2-night+ paid stays',amount:100},
      {id:'amb_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  chase_world_of_hyatt:{name:'World of Hyatt',fee:95,historicalFees:{2025:95},feeMonth:0,feeDay:1,sections:[
    {label:'Annual',cadence:'annual',benefits:[
      {id:'hyatt_freenight',name:'Free Night Award',desc:'One free night at Category 1–4 Hyatt properties',amount:150},
    ]},
  ]},
  chase_united_quest:{name:'United Quest',fee:250,historicalFees:{2025:250},feeMonth:0,feeDay:1,sections:[
    {label:'Semi-annual (calendar)',cadence:'cal-semi-annual',benefits:[
      {id:'uq_credit',name:'United Purchase Credit',desc:'Statement credit on United Airlines purchases',amount:125,partial:true},
    ]},
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'uq_miles',name:'Award Miles Back',desc:'Up to 10,000 miles back per year on United award redemptions',amount:100},
      {id:'uq_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  chase_united_club:{name:'United Club Infinite',fee:525,historicalFees:{2025:525},feeMonth:0,feeDay:1,sections:[
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'uc_club',name:'United Club Membership',desc:'Unlimited United Club lounge access for cardholder + guests',amount:700},
      {id:'uc_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  citi_strata_prem:{name:'Citi Strata Premier',fee:95,historicalFees:{2025:95},feeMonth:0,feeDay:1,sections:[
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'citist_hotel',name:'Hotel Benefit',desc:'$100 off a single hotel stay of $500+ via CitiTravel',amount:100},
    ]},
  ]},
  wf_premier_autograph:{name:'WF Premier Autograph',fee:95,historicalFees:{2025:95,2026:95},feeMonth:0,feeDay:1,sections:[
    {label:'Annual (calendar year)',cadence:'cal-annual-overlap',benefits:[
      {id:'wfpa_airline',name:'Airline Credit',desc:'Statement credit on airline purchases — flights, seat upgrades, bag fees, in-flight purchases',amount:50,partial:true},
    ]},
    {label:'Benefit (every 4 years)',cadence:'cal-annual',benefits:[
      {id:'wfpa_ge',name:'Global Entry / TSA PreCheck',desc:'Statement credit every 4 years',amount:120},
    ]},
  ]},
  amex_biz_gold:{name:'AMEX Business Gold',fee:375,historicalFees:{2025:375},feeMonth:0,feeDay:1,sections:[
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'abizg_chatgpt',name:'ChatGPT Business Credit',desc:'Statement credit on U.S. ChatGPT Business purchases',amount:300},
    ]},
  ]},
  amex_biz_plat:{name:'AMEX Business Platinum',fee:695,historicalFees:{2025:695},feeMonth:0,feeDay:1,sections:[
    {label:'Annual (calendar year)',cadence:'cal-annual',benefits:[
      {id:'abizp_chatgpt',name:'ChatGPT Business Credit',desc:'Statement credit on U.S. ChatGPT Business purchases',amount:300},
    ]},
  ]},
};

// ── Premium card catalog ──────────────────────────────────────────────────
export const PREMIUM_CARD_CATALOG = [
  // American Express
  {id:'platinum',issuer:'American Express',name:'Amex Platinum',fee:895,supported:true},
  {id:'gold',issuer:'American Express',name:'Amex Gold',fee:325,supported:true},
  {id:'amex_green',issuer:'American Express',name:'Amex Green',fee:150,supported:true},
  {id:'amex_biz_plat',issuer:'American Express',name:'Amex Business Platinum',fee:695,supported:true},
  {id:'amex_biz_gold',issuer:'American Express',name:'Amex Business Gold',fee:375,supported:true},
  {id:'amex_delta_reserve',issuer:'American Express',name:'Delta SkyMiles Reserve',fee:650,supported:false},
  {id:'amex_delta_plat',issuer:'American Express',name:'Delta SkyMiles Platinum',fee:350,supported:false},
  {id:'amex_hilton_honors',issuer:'American Express',name:'Hilton Honors Aspire',fee:550,supported:true},
  {id:'amex_marriott_brill',issuer:'American Express',name:'Marriott Bonvoy Brilliant',fee:650,supported:true},
  {id:'amex_marriott_biz',issuer:'American Express',name:'Marriott Bonvoy Business',fee:125,supported:false},
  // Chase
  {id:'csr',issuer:'Chase',name:'Chase Sapphire Reserve',fee:795,supported:true},
  {id:'chase_sapphire_pref',issuer:'Chase',name:'Chase Sapphire Preferred',fee:95,supported:true},
  {id:'chase_ink_pref',issuer:'Chase',name:'Chase Ink Business Preferred',fee:95,supported:false},
  {id:'chase_world_of_hyatt',issuer:'Chase',name:'World of Hyatt',fee:95,supported:true},
  {id:'chase_united_quest',issuer:'Chase',name:'United Quest',fee:250,supported:true},
  {id:'chase_united_club',issuer:'Chase',name:'United Club Infinite',fee:525,supported:true},
  {id:'chase_southwest_pref',issuer:'Chase',name:'Southwest Rapid Rewards Priority',fee:149,supported:false},
  {id:'chase_marriott_bold',issuer:'Chase',name:'Marriott Bonvoy Boundless',fee:95,supported:false},
  // Capital One
  {id:'cap1_venture_x',issuer:'Capital One',name:'Venture X',fee:395,supported:true},
  {id:'cap1_venture_x_biz',issuer:'Capital One',name:'Venture X Business',fee:395,supported:false},
  {id:'cap1_savor',issuer:'Capital One',name:'Savor Cash Rewards',fee:95,supported:false},
  // Citi
  {id:'citi_strata_prem',issuer:'Citi',name:'Citi Strata Premier',fee:95,supported:true},
  {id:'citi_prestige',issuer:'Citi',name:'Citi Prestige',fee:495,supported:false},
  {id:'citi_aa_exec',issuer:'Citi',name:'AAdvantage Executive World Elite',fee:595,supported:false},
  {id:'citi_aa_plat',issuer:'Citi',name:'AAdvantage Platinum Select',fee:99,supported:false},
  // Wells Fargo
  {id:'wf_premier_autograph',issuer:'Wells Fargo',name:'Premier Autograph Visa Infinite',fee:95,supported:true},
  // Bank of America
  {id:'boa_premium',issuer:'Bank of America',name:'Premium Rewards Elite',fee:550,supported:false},
  {id:'boa_alaska_sig',issuer:'Bank of America',name:'Alaska Airlines Signature',fee:95,supported:false},
  // US Bank — hidden; re-enable if expanding issuer coverage
  // {id:'usb_altitude_reserve',issuer:'US Bank',name:'Altitude Reserve Visa Infinite',fee:400,supported:false},
  // {id:'usb_altitude_connect',issuer:'US Bank',name:'Altitude Connect',fee:95,supported:false},
  // Barclays — hidden; re-enable if expanding issuer coverage
  // {id:'barc_aa_aviator',issuer:'Barclays',name:'AAdvantage Aviator Red',fee:99,supported:false},
  // {id:'barc_jac',issuer:'Barclays',name:'JetBlue Plus',fee:99,supported:false},
  // Other
  {id:'bilt',issuer:'Bilt',name:'Bilt Mastercard',fee:0,supported:false},
  {id:'apple_card',issuer:'Apple',name:'Apple Card',fee:0,supported:false},
];

export const TRANSFER_PARTNERS={
  gold:['Air Canada Aeroplan','ANA Mileage Club','British Airways Executive Club','Cathay Pacific Asia Miles','Delta SkyMiles','Emirates Skywards','Etihad Guest','Flying Blue (Air France/KLM)','Iberia Plus','JetBlue TrueBlue','Qatar Airways Privilege Club','Singapore Airlines KrisFlyer','Virgin Atlantic Flying Club'],
  platinum:['Air Canada Aeroplan','ANA Mileage Club','British Airways Executive Club','Cathay Pacific Asia Miles','Delta SkyMiles','Emirates Skywards','Etihad Guest','Flying Blue (Air France/KLM)','Iberia Plus','JetBlue TrueBlue','Qatar Airways Privilege Club','Singapore Airlines KrisFlyer','Virgin Atlantic Flying Club'],
  cap1_venture_x:['Aeromexico Club Premier','Air Canada Aeroplan','Air France/KLM Flying Blue','Avianca LifeMiles','British Airways Executive Club','Choice Privileges','Emirates Skywards','Etihad Guest','EVA Air Infinity MileageLands','Finnair Plus','Singapore Airlines KrisFlyer','Turkish Airlines Miles&Smiles','Virgin Red'],
  csr:['Air Canada Aeroplan','British Airways Executive Club','Emirates Skywards','Flying Blue (Air France/KLM)','Iberia Plus','JetBlue TrueBlue','Singapore Airlines KrisFlyer','Southwest Rapid Rewards','United MileagePlus','Virgin Atlantic Flying Club','Hyatt World of Hyatt','IHG One Rewards','Marriott Bonvoy'],
  citi_strata_prem:['Air France/KLM Flying Blue','Avianca LifeMiles','Cathay Pacific Asia Miles','Emirates Skywards','Etihad Guest','EVA Air Infinity MileageLands','Jet Airways InterMiles','Qatar Airways Privilege Club','Singapore Airlines KrisFlyer','Thai Royal Orchid Plus','Turkish Airlines Miles&Smiles','Virgin Atlantic Flying Club'],
  wf_premier_autograph:['Aer Lingus AerClub','Air France/KLM Flying Blue','Avianca LifeMiles','British Airways Executive Club','Choice Privileges','Iberia Plus','Turkish Airlines Miles&Smiles'],
};

export const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTHS_FULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const CAT_COLORS={dining:'#C86428',travel:'#6366f1',shopping:'var(--gold)',fitness:'var(--green)',entertainment:'#9333ea'};
export const CARD_LABELS={gold:'AMEX Gold',platinum:'AMEX Platinum',csr:'Chase Sapphire Reserve',cap1_venture_x:'Capital One Venture X',chase_sapphire_pref:'Sapphire Preferred',amex_green:'AMEX Green',amex_hilton_honors:'Hilton Honors Aspire',amex_marriott_brill:'Marriott Bonvoy Brilliant',chase_world_of_hyatt:'World of Hyatt',chase_united_quest:'United Quest',chase_united_club:'United Club Infinite',citi_strata_prem:'Citi Strata Premier',wf_premier_autograph:'WF Premier Autograph',amex_biz_gold:'AMEX Biz Gold',amex_biz_plat:'AMEX Biz Platinum'};
export const CARD_SHORT_LABELS={gold:'Gold',platinum:'Platinum',csr:'CSR',cap1_venture_x:'Venture X',chase_sapphire_pref:'Sapphire P',amex_green:'Green',amex_hilton_honors:'Hilton',amex_marriott_brill:'Marriott',chase_world_of_hyatt:'Hyatt',chase_united_quest:'United Q',chase_united_club:'United C',citi_strata_prem:'Strata P',wf_premier_autograph:'WF Prem',amex_biz_gold:'Biz Gold',amex_biz_plat:'Biz Plat'};
export const CARD_CLS={gold:'gold',platinum:'platinum',csr:'csr',cap1_venture_x:'venturex',chase_sapphire_pref:'csp',amex_green:'amexgreen',amex_hilton_honors:'hilton',amex_marriott_brill:'marriott',chase_world_of_hyatt:'hyatt',chase_united_quest:'unitedq',chase_united_club:'unitedclub',citi_strata_prem:'citistrata',wf_premier_autograph:'wfpremier',amex_biz_gold:'gold',amex_biz_plat:'platinum'};
export const FEE_MONTHS=Object.fromEntries(Object.keys(CARDS).map(k=>[k,CARDS[k].feeMonth??0]));

export const BENEFIT_CATEGORIES={
  vx_travel:'travel', vx_anniv:'travel', vx_hotel:'travel', vx_ge:'travel',
  g_dining:'dining', g_uber:'dining', g_dunkin:'dining', g_resy:'dining', g_hotel:'travel',
  p_uber:'travel', p_digital:'entertainment', p_walmart:'shopping',
  p_resy:'dining', p_lulu:'shopping', p_hotel:'travel', p_saks:'shopping',
  p_airline:'travel', p_equinox:'fitness', p_ge:'travel', p_clear:'travel', p_uberone:'travel', p_oura:'fitness',
  c_dd_restaurant:'dining', c_dd_nonrest1:'shopping', c_dd_nonrest2:'shopping',
  c_lyft:'travel', c_peloton:'fitness', c_dining:'dining', c_stub:'entertainment',
  c_travel:'travel', c_edit1:'travel', c_edit2:'travel', c_ge:'travel', c_selecthotel:'travel',
  c_apple:'entertainment',
  jmr_dining:'dining', jmr_travel:'travel', jmr_ge:'travel',
  csp_hotel:'travel', csp_dashpass:'shopping', csp_apple:'entertainment', csp_ge:'travel',
  ag_clear:'travel', ag_lounge:'travel',
  ah_resort:'travel', ah_airline:'travel', ah_freenight:'travel', ah_ge:'travel',
  amb_dining:'dining', amb_freenight:'travel', amb_propcredit:'travel', amb_ge:'travel',
  ambb_freenight:'travel',
  adr_resy:'dining', adr_stays:'travel', adr_companion:'travel', adr_ge:'travel',
  adp_resy:'dining', adp_stays:'travel', adp_companion:'travel', adp_ge:'travel',
  hyatt_freenight:'travel',
  uq_credit:'travel', uq_miles:'travel', uq_ge:'travel',
  uc_club:'travel', uc_ge:'travel',
  citist_hotel:'travel',
  usbar_travel:'travel', usbar_ge:'travel',
  vxb_travel:'travel', vxb_anniv:'travel', vxb_ge:'travel',
  wfpa_airline:'travel', wfpa_ge:'travel',
  abizg_chatgpt:'entertainment', abizp_chatgpt:'entertainment',
};

export const POINTS_PROGRAMS={
  membership_rewards:{name:'Amex Membership Rewards',centsPerPt:2.0,cards:['gold','platinum','amex_green','amex_biz_gold','amex_biz_plat']},
  chase_ur:{name:'Chase Ultimate Rewards',centsPerPt:2.0,cards:['csr','chase_sapphire_pref']},
  venture_miles:{name:'Capital One Venture Miles',centsPerPt:1.85,cards:['cap1_venture_x']},
  hyatt_points:{name:'World of Hyatt Points',centsPerPt:1.7,cards:['chase_world_of_hyatt']},
  united_miles:{name:'United MileagePlus',centsPerPt:1.4,cards:['chase_united_quest','chase_united_club']},
  thankyou_points:{name:'Citi ThankYou Points',centsPerPt:1.8,cards:['citi_strata_prem']},
  hilton_honors:{name:'Hilton Honors Points',centsPerPt:0.6,cards:['amex_hilton_honors']},
  marriott_bonvoy:{name:'Marriott Bonvoy Points',centsPerPt:0.9,cards:['amex_marriott_brill']},
  wf_rewards:{name:'Wells Fargo Rewards',centsPerPt:1.0,cards:['wf_premier_autograph']},
};

export const POINTS_MULTIPLIERS={
  gold:[
    {cat:'Dining (US & worldwide restaurants, up to $50K/yr)',pts:'4x'},
    {cat:'US Supermarkets (up to $25K/yr)',pts:'4x'},
    {cat:'Prepaid hotels (amextravel.com)',pts:'5x'},
    {cat:'Flights (direct or amextravel.com)',pts:'3x'},
    {cat:'Prepaid car rentals & cruises (amextravel.com)',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  platinum:[
    {cat:'Flights (direct or amextravel.com, up to $500K/yr)',pts:'5x'},
    {cat:'Prepaid hotels (amextravel.com)',pts:'5x'},
    {cat:'Everything else',pts:'1x'},
  ],
  cap1_venture_x:[
    {cat:'Capital One Travel (hotels & rental cars)',pts:'10x'},
    {cat:'Capital One Travel (flights & vacation rentals)',pts:'5x'},
    {cat:'Everything else',pts:'2x'},
  ],
  csr:[
    {cat:'Chase Travel℠ (incl. The Edit)',pts:'8x'},
    {cat:'Lyft rides (through Sep 2027)',pts:'5x'},
    {cat:'Flights & hotels (booked direct)',pts:'4x'},
    {cat:'Dining (worldwide)',pts:'3x'},
    {cat:'Peloton hardware (up to 50K pts)',pts:'10x'},
    {cat:'Everything else',pts:'1x'},
  ],
  jp_morgan_reserve:[
    {cat:'Dining',pts:'3x'},
    {cat:'Travel (Chase Travel portal)',pts:'3x'},
    {cat:'Everything else',pts:'1x'},
  ],
  chase_sapphire_pref:[
    {cat:'Chase Travel℠',pts:'5x'},
    {cat:'Dining & online grocery (excl. Walmart/Target)',pts:'3x'},
    {cat:'Streaming services',pts:'3x'},
    {cat:'Everything else',pts:'1x'},
  ],
  bilt:[
    {cat:'Rent (via Bilt, up to 100,000 pts/yr)',pts:'1x'},
    {cat:'Dining',pts:'3x'},
    {cat:'Travel',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  amex_green:[
    {cat:'Travel (flights, hotels, transit, taxis)',pts:'3x'},
    {cat:'Dining (worldwide)',pts:'3x'},
    {cat:'Everything else',pts:'1x'},
  ],
  amex_hilton_honors:[
    {cat:'Hilton hotels & resorts',pts:'14x'},
    {cat:'Dining (US), US Supermarkets, US Gas stations',pts:'7x'},
    {cat:'Flights (direct or amextravel.com)',pts:'7x'},
    {cat:'Everything else',pts:'3x'},
  ],
  amex_marriott_brill:[
    {cat:'Marriott Bonvoy hotels',pts:'6x'},
    {cat:'Dining (US restaurants)',pts:'4x'},
    {cat:'Flights (direct or amextravel.com)',pts:'2x'},
    {cat:'Everything else',pts:'2x'},
  ],
  amex_marriott_biz:[
    {cat:'Marriott Bonvoy hotels',pts:'6x'},
    {cat:'US restaurants, gas, wireless, shipping, transit',pts:'4x'},
    {cat:'Everything else',pts:'2x'},
  ],
  amex_delta_reserve:[
    {cat:'Delta purchases',pts:'3x'},
    {cat:'Hotels & US restaurants',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  amex_delta_plat:[
    {cat:'Delta purchases',pts:'3x'},
    {cat:'Hotels & US restaurants',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  chase_world_of_hyatt:[
    {cat:'Hyatt hotels & all-inclusive properties',pts:'9x'},
    {cat:'Dining, local transit, gym memberships',pts:'2x'},
    {cat:'Flights & car rentals (direct)',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  chase_united_quest:[
    {cat:'United purchases',pts:'3x'},
    {cat:'Dining & streaming services',pts:'2x'},
    {cat:'Hotels & car rentals',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  chase_united_club:[
    {cat:'United purchases',pts:'4x'},
    {cat:'All other travel & dining',pts:'2x'},
    {cat:'Everything else',pts:'1x'},
  ],
  citi_strata_prem:[
    {cat:'Air, hotels, car rentals & restaurants',pts:'3x'},
    {cat:'Supermarkets & gas stations',pts:'3x'},
    {cat:'Everything else',pts:'1x'},
  ],
  wf_premier_autograph:[
    {cat:'Hotels (booked directly)',pts:'5x'},
    {cat:'Airlines (booked directly)',pts:'4x'},
    {cat:'Other travel (car rentals, trains, cruises)',pts:'3x'},
    {cat:'Dining (worldwide restaurants)',pts:'3x'},
    {cat:'Everything else',pts:'1x'},
  ],
  usb_altitude_reserve:[
    {cat:'Travel & mobile wallet purchases',pts:'3x'},
    {cat:'Everything else',pts:'1x'},
  ],
  cap1_venture_x_biz:[
    {cat:'Capital One Travel (hotels & rental cars)',pts:'10x'},
    {cat:'Capital One Travel (flights & vacation rentals)',pts:'5x'},
    {cat:'Everything else',pts:'2x'},
  ],
};
