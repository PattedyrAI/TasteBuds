/** Shared display names keep equivalent subcategories together without merging items. */
const aliases: Record<string, string> = {
  'energy drink': 'Energy drinks', 'energy drinks': 'Energy drinks',
  burger: 'Burgers', burgers: 'Burgers', hamburger: 'Burgers', hamburgers: 'Burgers', cheeseburger: 'Burgers', cheeseburgers: 'Burgers',
  pizza: 'Pizza', pizzas: 'Pizza', noodle: 'Noodles', noodles: 'Noodles',
  ramen: 'Noodles', ramyeon: 'Noodles',
  sandwich: 'Sandwiches', sandwiches: 'Sandwiches',
  gyro: 'Gyros', gyros: 'Gyros',
  'protein bar': 'Protein bars', 'protein bars': 'Protein bars',
  salad: 'Salads', salads: 'Salads', soup: 'Soups', soups: 'Soups',
  'soup dumplings': 'Dumplings', dumpling: 'Dumplings', dumplings: 'Dumplings',
  'veggie burger': 'Burgers', 'veggie burgers': 'Burgers',
  cake: 'Cakes', cakes: 'Cakes', donut: 'Donuts', donuts: 'Donuts', doughnut: 'Donuts', doughnuts: 'Donuts',
  pretzel: 'Pretzels', pretzels: 'Pretzels', crepe: 'Crepes', crepes: 'Crepes',
  calzone: 'Calzones', calzones: 'Calzones', pastry: 'Pastries', pastries: 'Pastries',
  'egg dish': 'Egg dishes', 'egg dishes': 'Egg dishes',
  milkshake: 'Milkshakes', milkshakes: 'Milkshakes',
  'hard seltzer': 'Hard seltzer', 'hard seltzers': 'Hard seltzer',
  refresher: 'Refreshers', refreshers: 'Refreshers',
  'chicken wing': 'Chicken wings', 'chicken wings': 'Chicken wings', 'buffalo wings': 'Chicken wings', 'fried chicken wings': 'Chicken wings',
  'mac and cheese': 'Mac and cheese', 'mac cheese': 'Mac and cheese', 'macaroni and cheese': 'Mac and cheese',
  'soft drink': 'Soft drinks', 'soft drinks': 'Soft drinks', soda: 'Soft drinks', sodas: 'Soft drinks',
  'ice cream': 'Ice cream', 'ice creams': 'Ice cream',
  'french fries': 'Fries', fries: 'Fries',
  coffee: 'Coffee', tea: 'Tea', beer: 'Beer',
  'potato chips': 'Chips', crisps: 'Chips', chips: 'Chips',
};

export function canonicalItemType(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const key = trimmed.toLowerCase().replace(/&/g, 'and').replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
  return Object.hasOwn(aliases, key) ? aliases[key] : trimmed;
}
