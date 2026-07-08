[out:json][timeout:90];
(
  // water
  way["natural"="water"](59.766,10.290,59.847,10.446);
  relation["natural"="water"](59.766,10.290,59.847,10.446);
  way["waterway"~"stream|river|ditch"](59.766,10.290,59.847,10.446);
  // paths, tracks, forest roads, residential
  way["highway"~"path|track|footway|cycleway|bridleway|unclassified|residential|service|tertiary"](59.766,10.290,59.847,10.446);
  // peaks / topography
  node["natural"~"peak|saddle"](59.766,10.290,59.847,10.446);
  // huts / shelters
  node["tourism"~"wilderness_hut|alpine_hut|picnic_site|viewpoint"](59.766,10.290,59.847,10.446);
  way["tourism"~"wilderness_hut|alpine_hut"](59.766,10.290,59.847,10.446);
  // cultural heritage / industrial
  node["historic"](59.766,10.290,59.847,10.446);
  way["historic"](59.766,10.290,59.847,10.446);
  node["man_made"~"charcoal_pile|mineshaft|adit|mine"](59.766,10.290,59.847,10.446);
  way["landuse"="quarry"](59.766,10.290,59.847,10.446);
  node["place"~"locality|hamlet|village|isolated_dwelling|farm"](59.766,10.290,59.847,10.446);
);
out body;
>;
out skel qt;
