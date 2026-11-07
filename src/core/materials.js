// The material catalogue (Materials panel, Paint Bucket). In core so reports can name a colour ("Concrete").
export const MATERIALS = [
  { name: 'Plaster', color: '#e9e4d8', roughness: 0.9 },
  { name: 'Concrete', color: '#a7a39a', roughness: 0.95 },
  { name: 'Brick', color: '#a8553c', roughness: 0.9 },
  { name: 'Terracotta', color: '#d2775a', roughness: 0.8 },
  { name: 'Oak', color: '#b58a57', roughness: 0.7 },
  { name: 'Walnut', color: '#5e3f2b', roughness: 0.6 },
  { name: 'Mustard', color: '#e8bc5e', roughness: 0.6 },
  { name: 'Fern', color: '#4c7a5a', roughness: 0.8 },
  { name: 'Grass', color: '#6f9a4a', roughness: 1 },
  { name: 'Water', color: '#3f879c', roughness: 0.1, opacity: 0.7 },
  { name: 'Glass', color: '#b8dbe2', roughness: 0.05, opacity: 0.35 },
  { name: 'Steel', color: '#9aa3ab', roughness: 0.35, metalness: 0.9 },
  { name: 'Copper', color: '#b8734a', roughness: 0.35, metalness: 0.9 },
  { name: 'Ink', color: '#1e3a4c', roughness: 0.5 },
  { name: 'Asphalt', color: '#3c3f44', roughness: 1 },
  { name: 'Snow', color: '#fbfbf8', roughness: 0.9 },
];

/** The catalogue name of a colour, or the colour itself. */
export const materialName = (color) => MATERIALS.find((m) => m.color.toLowerCase() === String(color).toLowerCase())?.name ?? color;
