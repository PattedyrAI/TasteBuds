/** Brand marks verified against primary brand sites and stored as inert local PNGs. */
const logos: Record<string, string> = {
  "3D": "/brands/3d.png",
  "AA Drink": "/brands/aa-drink.png",
  "Adrenaline Rush": "/brands/adrenaline-rush.png",
  "Alani Nu": "/brands/alani-nu.png",
  "Arizona": "/brands/arizona.png",
  "Bang": "/brands/bang.png",
  "Battery": "/brands/battery.png",
  "Berliner Luft": "/brands/berliner-luft.png",
  "Biltema": "/brands/biltema.png",
  "Black Rifle": "/brands/black-rifle.png",
  "Bloom": "/brands/bloom.png",
  "Bojangles": "/brands/bojangles.png",
  "Bomba": "/brands/bomba.png",
  "Built": "/brands/built.png",
  "Buldak": "/brands/buldak.png",
  "Burger King": "/brands/burger-king.png",
  "Burn": "/brands/burn.png",
  "C4": "/brands/c4.png",
  "Cabot": "/brands/cabot.png",
  "Cayman Jack": "/brands/cayman-jack.png",
  "Celsius": "/brands/celsius.png",
  "Cheetos": "/brands/cheetos.png",
  "Cousins Maine Lobster": "/brands/cousins-maine-lobster.png",
  "Cult": "/brands/cult.png",
  "Devour": "/brands/devour.png",
  "Dunkin'": "/brands/dunkin.png",
  "Faxe Kondi": "/brands/faxe-kondi.png",
  "Fulfil": "/brands/fulfil.png",
  "G Fuel": "/brands/g-fuel.png",
  "Ghost": "/brands/ghost.png",
  "Giovanni Rana": "/brands/giovanni-rana.png",
  "Goodles": "/brands/goodles.png",
  "Gorilla": "/brands/gorilla.png",
  "Gorilla Mind": "/brands/gorilla-mind.png",
  "Guinness": "/brands/guinness.png",
  "Hell": "/brands/hell.png",
  "Hitschies": "/brands/hitschies.png",
  "Jack Link's": "/brands/jack-link-s.png",
  "Knorr": "/brands/knorr.png",
  "Kraft": "/brands/kraft.png",
  "Kronenbourg": "/brands/kronenbourg.png",
  "Lemonsoda": "/brands/lemonsoda.png",
  "Lucky Energy": "/brands/lucky-energy.png",
  "M&S": "/brands/m-s.png",
  "Menraku": "/brands/menraku.png",
  "Met-Rx": "/brands/met-rx.png",
  "Milkshake Factory": "/brands/milkshake-factory.png",
  "Monster": "/brands/monster.png",
  "Mountain Dew": "/brands/mountain-dew.png",
  "NOS": "/brands/nos.png",
  "Nocco": "/brands/nocco.png",
  "Optimum Nutrition": "/brands/optimum-nutrition.png",
  "Oreo": "/brands/oreo.png",
  "Paris Baguette": "/brands/paris-baguette.png",
  "Prime": "/brands/prime.png",
  "Raptor": "/brands/raptor.png",
  "Red Bull": "/brands/red-bull.png",
  "Reign": "/brands/reign.png",
  "Relentless": "/brands/relentless.png",
  "Rip It": "/brands/rip-it.png",
  "Rise": "/brands/rise.png",
  "Rockstar": "/brands/rockstar.png",
  "Ryse": "/brands/ryse.png",
  "Shaqalicious": "/brands/shaqalicious.png",
  "Sørlands Chips": "/brands/s-rlands-chips.png",
  "Toxic Waste": "/brands/toxic-waste.png",
  "Trader Joe's": "/brands/trader-joes.png",
  "Uptime": "/brands/uptime.png",
  "VELO": "/brands/velo.png",
  "Velveeta": "/brands/velveeta.png",
  "Vikingsnacks": "/brands/vikingsnacks.png",
  "White Claw": "/brands/white-claw.png",
  "ZOA": "/brands/zoa.png",
};
const aliases: Record<string, string> = {
  "Burn Energy": "Burn",
  "GFUEL": "G Fuel",
  "Sørlandschips": "Sørlands Chips",
  "Sorlandschips": "Sørlands Chips",
};

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[’‘]/g, "'").toLocaleLowerCase("en");
}
const byNormalizedName = new Map(Object.entries(logos).map(([name, src]) => [normalized(name), { name, src }]));
for (const [alias, name] of Object.entries(aliases)) {
  const logo = logos[name];
  if (logo) byNormalizedName.set(normalized(alias), { name, src: logo });
}

export function brandLogo(brand: string | null): { src: string; alt: string } | null {
  if (!brand?.trim()) return null;
  const match = byNormalizedName.get(normalized(brand));
  return match ? { src: match.src, alt: `${match.name} logo` } : null;
}
