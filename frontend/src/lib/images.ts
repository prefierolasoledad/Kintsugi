export function unsplash(id: string, params = "w=1600&q=80&auto=format&fit=crop") {
  return `https://images.unsplash.com/photo-${id}?${params}`;
}

export const IMAGES = {
  heroFleaMarket: unsplash("1760625345932-448b852afdf9"),
  clothingRack: unsplash("1637228393246-c38a4b3d2011"),
  antiqueFurniture: unsplash("1758380742318-4074cce52ec4"),
  vinylRecords: unsplash("1760302318625-cbe999965d8a"),
  vintageTrinkets: unsplash("1767338718786-92f7934e925e"),
  kintsugiPlate: unsplash("1622021134395-d26aab83c221"),
  vintageCamera: unsplash("1741555165521-4c9e762fb2e8"),
  recordPlayer: unsplash("1766592946837-ab4454c4a8a3"),
  leatherJacket: unsplash("1623854156816-4c4fc355ffc7"),
  midCenturyChairs: unsplash("1718049719688-764249c6800d"),
};
