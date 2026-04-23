// Sample data for the Housemait family
const FAMILY = {
  household: 'The Reid family',
  members: [
    { id:'g',  name:'Grant',  short:'G',  color:'#6BA368', role:'Admin' },
    { id:'em', name:'Emma',   short:'E',  color:'#D8788A', role:'Parent' },
    { id:'m',  name:'Mason',  short:'M',  color:'#5B8DE0', role:'Kid · 11' },
    { id:'l',  name:'Lily',   short:'L',  color:'#D89B3A', role:'Kid · 8' },
  ],
};

const TODAY = {
  weekday: 'Saturday',
  date: '18 April',
  long: 'Saturday 18 April',
};

const SCHEDULE = [
  { id:'s1', title:'Mason · tennis',          time:'15:30', end:'16:30', who:'m',  color:'#5B8DE0', loc:'Bishop\'s Park courts' },
  { id:'s2', title:'Lily · ballet recital',   time:'16:30', end:'18:00', who:'l',  color:'#D89B3A', loc:'St Mary\'s hall' },
  { id:'s3', title:'Family dinner · Nonna',   time:'19:00', end:'21:00', who:'all',color:'#6C3DD9', loc:'Home' },
];

const TASKS_INIT = [
  { id:'t1', title:'Fix light on stairwell',          who:'g',  done:false, due:'Today',    cat:'Home'   },
  { id:'t2', title:'Assemble trampoline',             who:'g',  done:false, due:'Today',    cat:'Home'   },
  { id:'t3', title:'Book dog nail-cut appointment',   who:'em', done:false, due:'Tomorrow', cat:'Pets'   },
  { id:'t4', title:'Book dog deworming',              who:'em', done:false, due:'Tomorrow', cat:'Pets'   },
  { id:'t5', title:'Cut the dog\'s nails',            who:'g',  done:false, due:'Mon',      cat:'Pets'   },
  { id:'t6', title:'Sign Lily\'s school permission',  who:'em', done:true,  due:'Yesterday',cat:'Kids'   },
  { id:'t7', title:'Pay window-cleaner',              who:'g',  done:false, due:'Wed',      cat:'Bills'  },
];

const GROCERIES_INIT = [
  { id:'g1', name:'Eggs',          qty:'2 dozen',     cat:'Dairy',  done:false, list:'default' },
  { id:'g2', name:'Beef sausages', qty:'500g',        cat:'Meat',   done:false, list:'sainsburys' },
  { id:'g3', name:'Mango',         qty:'2',           cat:'Veg',    done:false, list:'default' },
  { id:'g4', name:'Pears',         qty:'4',           cat:'Veg',    done:false, list:'default' },
  { id:'g5', name:'Sourdough',     qty:'1 loaf',      cat:'Bakery', done:true,  list:'default' },
  { id:'g6', name:'Whole milk',    qty:'2L',          cat:'Dairy',  done:false, list:'default' },
  { id:'g7', name:'Spinach',       qty:'1 bag',       cat:'Veg',    done:false, list:'tesco' },
  { id:'g8', name:'Olive oil',     qty:'500ml',       cat:'Pantry', done:false, list:'waitrose' },
  { id:'g9', name:'Lily\'s yoghurt drinks', qty:'6-pack', cat:'Dairy', done:false, list:'default' },
  { id:'g10',name:'Coffee beans',  qty:'250g',        cat:'Pantry', done:false, list:'waitrose' },
  { id:'g11',name:'Digestives',    qty:'1 pack',      cat:'Pantry', done:false, list:'aldi' },
  { id:'g12',name:'Frozen peas',   qty:'1kg',         cat:'Frozen', done:false, list:'aldi' },
  { id:'g13',name:'Flowers',       qty:'bouquet',     cat:'Pantry', done:false, list:'ms' },
];

const SHOPPING_LISTS = [
  { id:'default',     name:'Default',      emoji:'🛒' },
  { id:'tesco',       name:'Tesco',        emoji:'🏪' },
  { id:'sainsburys',  name:'Sainsbury\'s', emoji:'🛍️' },
  { id:'aldi',        name:'Aldi',         emoji:'🥫' },
  { id:'waitrose',    name:'Waitrose',     emoji:'🍷' },
  { id:'ms',          name:'M&S',          emoji:'🥐' },
];

const CAT_COLORS = {
  Dairy:  { bg:'#E2ECFA', fg:'#3B5C8C' },
  Meat:   { bg:'#FBE6EA', fg:'#A04257' },
  Veg:    { bg:'#E5F0E2', fg:'#3F6E3D' },
  Bakery: { bg:'#FBF1DE', fg:'#85622A' },
  Pantry: { bg:'#F0EBE0', fg:'#5C5544' },
  Frozen: { bg:'#E6EEF2', fg:'#3F5A66' },
};

const TASK_CAT_COLORS = {
  Home:  '#6C3DD9',
  Pets:  '#D89B3A',
  Kids:  '#5B8DE0',
  Bills: '#D8788A',
};

const MEALS_INIT = [
  { day:'MON', date:13, breakfast:'Cheesy scrambled eggs on toast', lunch:'Tuna salad',             dinner:'Chicken Alfredo',      snack:'Apples' },
  { day:'TUE', date:14, breakfast:'Peanut butter toast',            lunch:'Pilau rice',             dinner:'Roast chicken',        snack:'Rice cakes' },
  { day:'WED', date:15, breakfast:'Fried eggs',                     lunch:'Speedy family mince nachos', dinner:'Spaghetti bolognese',  snack:'Gluten free fluffy pancakes' },
  { day:'THU', date:16, breakfast:null,                             lunch:null,                     dinner:null,                   snack:null },
  { day:'FRI', date:17, breakfast:null,                             lunch:null,                     dinner:null,                   snack:null },
  { day:'SAT', date:18, breakfast:null,                             lunch:null,                     dinner:null,                   snack:null },
  { day:'SUN', date:19, breakfast:null,                             lunch:null,                     dinner:null,                   snack:null },
];

const RECIPES = [
  { id:'r1',  name:'Cheesy scrambled eggs on toast', cat:'Breakfast', mins:10, serves:2, fav:true  },
  { id:'r2',  name:'Peanut butter toast',            cat:'Breakfast', mins:5,  serves:2, fav:false },
  { id:'r3',  name:'Fried eggs',                     cat:'Breakfast', mins:8,  serves:2, fav:true  },
  { id:'r4',  name:'Gluten free fluffy pancakes',    cat:'Breakfast', mins:20, serves:4, fav:true  },
  { id:'r5',  name:'Tuna salad',                     cat:'Lunch',     mins:10, serves:2, fav:false },
  { id:'r6',  name:'Pilau rice',                     cat:'Lunch',     mins:25, serves:4, fav:false },
  { id:'r7',  name:'Chicken curry',                  cat:'Lunch',     mins:40, serves:4, fav:true  },
  { id:'r8',  name:'Speedy family mince nachos',     cat:'Lunch',     mins:20, serves:4, fav:true  },
  { id:'r9',  name:'Chicken Alfredo',                cat:'Dinner',    mins:30, serves:4, fav:true  },
  { id:'r10', name:'Roast chicken',                  cat:'Dinner',    mins:90, serves:5, fav:true  },
  { id:'r11', name:'Spaghetti bolognese',            cat:'Dinner',    mins:35, serves:4, fav:false },
  { id:'r12', name:'Thai green curry',               cat:'Dinner',    mins:30, serves:4, fav:true  },
  { id:'r13', name:'Apples',                         cat:'Snack',     mins:1,  serves:1, fav:false },
  { id:'r14', name:'Rice cakes',                     cat:'Snack',     mins:1,  serves:1, fav:false },
  { id:'r15', name:'Hummus & carrots',               cat:'Snack',     mins:3,  serves:2, fav:true  },
];

// AI suggested chips on Home composer
const AI_CHIPS = [
  'Plan this week\'s meals',
  'Add carrots to the list',
  'When is Lily\'s recital?',
  'Scan this receipt',
];

const APRIL_2026 = (() => {
  // April 2026 — 1st is a Wednesday
  const offset = 3; // Sun=0; Wed = 3
  const days = [];
  for (let i=0; i<offset; i++) days.push(null);
  for (let d=1; d<=30; d++) days.push(d);
  while (days.length % 7 !== 0) days.push(null);
  const events = {
    14: [{ color:'#6C3DD9' }],
    16: [{ color:'#D8788A' }],
    18: [{ color:'#5B8DE0' }, { color:'#D89B3A' }, { color:'#6C3DD9' }],
    20: [{ color:'#5B8DE0' }],
    22: [{ color:'#6BA368' }, { color:'#5B8DE0' }],
    23: [{ color:'#6C3DD9' }],
    25: [{ color:'#D8788A' }],
    27: [{ color:'#5B8DE0' }],
    29: [{ color:'#6C3DD9' }],
  };
  return { days, events };
})();

const DOCS_FOLDERS = [
  { id:'f1', name:'School',       files:8,  color:'#E2ECFA', icon:'#5B8DE0' },
  { id:'f2', name:'Medical',      files:5,  color:'#FBE6EA', icon:'#D8788A' },
  { id:'f3', name:'Insurance',    files:4,  color:'#EFE9FB', icon:'#6C3DD9' },
  { id:'f4', name:'Pets',         files:3,  color:'#FBF1DE', icon:'#D89B3A' },
  { id:'f5', name:'Warranties',   files:6,  color:'#E5F0E2', icon:'#6BA368' },
  { id:'f6', name:'Tax & Finance',files:12, color:'#F0EBE0', icon:'#5C5544' },
];
const DOCS_RECENT = [
  { id:'d1', name:'Lily · school form.pdf',   kind:'pdf',   size:'284 KB', when:'Today',    folder:'School',    color:'#D8788A' },
  { id:'d2', name:'Dog · vaccination record', kind:'pdf',   size:'512 KB', when:'2 days ago',folder:'Pets',      color:'#D89B3A' },
  { id:'d3', name:'Car insurance renewal',    kind:'pdf',   size:'1.2 MB', when:'Apr 10',    folder:'Insurance', color:'#6C3DD9' },
  { id:'d4', name:'IMG_2431.heic',            kind:'image', size:'3.1 MB', when:'Apr 9',     folder:'Medical',   color:'#5B8DE0' },
];

const RECEIPTS = [
  { id:'r1', merchant:'Sainsbury\'s',  when:'Today · 14:12', total:'£68.40', items:14, matched:9,  status:'Matched',  color:'#6BA368' },
  { id:'r2', merchant:'Tesco',         when:'Wed · 18:06',   total:'£24.85', items:6,  matched:6,  status:'Matched',  color:'#6BA368' },
  { id:'r3', merchant:'Pet\'s at Home', when:'Apr 11',        total:'£31.20', items:3,  matched:2,  status:'Review',   color:'#D89B3A' },
];

window.HM_DATA = { FAMILY, TODAY, SCHEDULE, TASKS_INIT, GROCERIES_INIT, MEALS_INIT, RECIPES, CAT_COLORS, TASK_CAT_COLORS, AI_CHIPS, APRIL_2026, DOCS_FOLDERS, DOCS_RECENT, RECEIPTS, SHOPPING_LISTS };
