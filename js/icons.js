// The most popular, iconic characters, for the "⭐ Icons only" mode in the
// character games. A character counts if its name or Wookieepedia article
// matches one of these (aliases separated by |), unless debug mode says
// otherwise: a character's `iconic: true/false` always wins.
const ICONS = [
  // Jedi
  'Yoda', 'Luke Skywalker', 'Anakin Skywalker', 'Obi-Wan Kenobi|Ben Kenobi', 'Mace Windu', 'Qui-Gon Jinn', 'Ahsoka Tano',
  'Rey|Rey Skywalker', 'Grogu|Din Grogu|Baby Yoda', 'Kanan Jarrus|Caleb Dume', 'Ezra Bridger', 'Cal Kestis', 'Kit Fisto',
  'Plo Koon', 'Aayla Secura', 'Ki-Adi-Mundi', 'Shaak Ti', 'Luminara Unduli', 'Quinlan Vos', 'Leia Organa|Princess Leia',
  // Sith and dark side
  'Darth Vader', 'Darth Sidious|Sheev Palpatine|Palpatine|Emperor Palpatine', 'Darth Maul|Maul', 'Count Dooku|Dooku|Darth Tyranus',
  'Kylo Ren|Ben Solo', 'Snoke|Supreme Leader Snoke', 'Darth Revan|Revan', 'Darth Plagueis', 'Darth Bane', 'Asajj Ventress',
  'Savage Opress', 'Darth Nihilus', 'Starkiller|Galen Marek', 'The Grand Inquisitor|Grand Inquisitor', 'Second Sister|Trilla Suduri',
  'Darth Malak', 'Mother Talzin',
  // Bounty hunters
  'Boba Fett', 'Jango Fett', 'Cad Bane', 'Bossk', 'Greedo', 'IG-88', 'Dengar', 'Zam Wesell', 'Aurra Sing', 'Fennec Shand',
  'Din Djarin|The Mandalorian|Mando', 'Bo-Katan Kryze', 'Embo', 'Black Krrsantan|Krrsantan', 'Sabine Wren', 'Hondo Ohnaka',
  '4-LOM', 'Zuckuss', 'Durge',
  // Clone troopers
  'Rex|Captain Rex|CT-7567', 'Cody|Commander Cody|CC-2224', 'Fives|CT-27-5555', 'Echo|CT-21-0408', 'Wolffe|Commander Wolffe|CC-3636',
  'Hunter', 'Wrecker', 'Tech', 'Crosshair', 'Omega', 'Fox|Commander Fox|CC-1010', 'Bly|Commander Bly|CC-5052',
  'Gree|Commander Gree|CC-1004', 'Thorn|Commander Thorn|CC-6454', 'Hardcase', 'Jesse', 'Kix', 'Tup', 'Dogma',
  // Combat droids
  'Droideka|Destroyer droid', 'B1-series battle droid|B1 battle droid|Battle droid', 'B2-series super battle droid|Super battle droid',
  'IG-100 MagnaGuard|MagnaGuard', 'General Grievous|Grievous', 'HK-47', 'IG-11', 'BX-series droid commando|BX commando droid', 'K-2SO',
  'Dark trooper',
];

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const NAMES = new Set(ICONS.flatMap((group) => group.split('|').map(norm)));

export function isIconic(entry) {
  if (typeof entry.iconic === 'boolean') return entry.iconic;
  return NAMES.has(norm(entry.name)) || NAMES.has(norm(entry.wiki));
}
