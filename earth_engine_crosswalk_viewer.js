// Planting-year viewer for oil palm MAPPED IN 2024 in Indonesia and Malaysia.
// Paste this file into the Google Earth Engine JavaScript Code Editor.
// 1990–2015: point-in-time crosswalk from the 2021 YoP collection, restricted
// to TreeMap 2024 pixels coded 2015-or-earlier. 2016–2024: TreeMap annual codes.
// This is NOT observed historical/monthly palm extent. Replanting after 2021
// can make an older year assignment stale. Unmatched older pixels stay unknown.

var TREEMAP_ID =
  'projects/ee-adriadescals/assets/_OP2024/shared/Global_OPExpansion_2015-2024_v20260618';
// The authors' published Earth Engine example uses this source-owned asset.
// Its minNBR_date band is encoded as days since 1970-01-01. The downloadable
// Zenodo YoP GeoTIFF instead stores calendar-year integers in a single band;
// those two representations must not share the same decoding rule.
var YOP_2021_ID =
  'projects/ee-globaloilpalm/assets/shared/GlobalOilPalm_YoP_2021';
var GAUL_ID = 'FAO/GAUL/2025/level1';
var AREA_CRS = 'EPSG:4326'; // Parseable in Earth Engine; pixelArea remains geodesic.
var AREA_SCALE_M = 100; // Responsive sample of 10 m and 30 m inputs.
var BOUNDS = ee.Geometry.Rectangle([94, -12, 142, 8]);

var gaul = ee.FeatureCollection(GAUL_ID);
var treeTiles = ee.ImageCollection(TREEMAP_ID).filterBounds(BOUNDS);
var yopTiles = ee.ImageCollection(YOP_2021_ID).filterBounds(BOUNDS);
print('2021 author YoP tile count and first-tile bands',
  yopTiles.size(), ee.Image(yopTiles.first()).bandNames());
print('2021 YoP date-band projection',
  ee.Image(yopTiles.first()).select('minNBR_date').projection());
var raw = treeTiles.mosaic().select('ABFFYY');
var palmType = raw.divide(100000).floor(); // 1 industrial, 2 smallholder.
var palm2024 = palmType.eq(1).or(palmType.eq(2));
var treeCode = raw.mod(100).toInt(); // 15 <=2015; 16..24 annual years.

// This collection's minNBR_date is a number of days since 1970-01-01,
// not a literal YYYY value. Earth Engine's default nearest-neighbor sampling
// is appropriate for the categorical year when the 30 m image meets TreeMap.
var oldDays = yopTiles.mosaic().select('minNBR_date').unmask(-9999);
var epoch = ee.Date('1970-01-01');
var plantingYear = raw.multiply(0).toInt16().rename('planting_year');
for (var oldYear = 1990; oldYear <= 2015; oldYear++) {
  var startDay = ee.Date.fromYMD(oldYear, 1, 1).difference(epoch, 'day');
  var endDay = ee.Date.fromYMD(oldYear + 1, 1, 1).difference(epoch, 'day');
  var isOldYear = treeCode.eq(15).and(oldDays.gte(startDay))
    .and(oldDays.lt(endDay));
  plantingYear = plantingYear.where(isOldYear, oldYear);
}
for (var newYear = 2016; newYear <= 2024; newYear++) {
  plantingYear = plantingYear.where(treeCode.eq(newYear - 2000), newYear);
}
plantingYear = plantingYear.updateMask(palm2024);

// Four exhaustive categories of the fixed 2024 palm mask.
var evidence = raw.multiply(0).add(4).toByte()
  .where(treeCode.eq(15), 3)
  .where(plantingYear.gte(1990).and(plantingYear.lte(2015)), 1)
  .where(plantingYear.gte(2016).and(plantingYear.lte(2024)), 2)
  .rename('year_evidence').updateMask(palm2024);
// Fast overview, matching the visible 2024 TreeMap age cohorts. A 2024
// snapshot cannot reveal 2025 planting or any 2026 land-cover change.
var directAge2026 = raw.multiply(0).add(4).toByte()
  .where(treeCode.eq(15), 3)
  .where(treeCode.gte(16).and(treeCode.lte(22)), 2)
  .where(treeCode.gte(23).and(treeCode.lte(24)), 1)
  .rename('inferred_2026_age').updateMask(palm2024);
var EVIDENCE = [
  {code: 1, key: 'yop_2021_estimate_ha',
    label: '1990–2015: 2021 YoP estimate', color: 'e59c38'},
  {code: 2, key: 'treemap_2024_annual_ha',
    label: '2016–2024: TreeMap annual code', color: '15847d'},
  {code: 3, key: 'older_unresolved_ha',
    label: '2015 or earlier: year unresolved', color: '86558d'},
  {code: 4, key: 'other_unresolved_ha',
    label: '2024 palm: other year code', color: '899198'}
];

function countryFeatures() {
  return gaul.filter(ee.Filter.eq('ISO3_CODE', countrySelect.getValue()));
}

function regionFeatures() {
  var provinces = countryFeatures();
  var code = provinceSelect.getValue();
  return !code || code === 'ALL' ? provinces :
    provinces.filter(ee.Filter.eq('GAUL1_CODE', Number(code)));
}

function typeMask(typeValue) {
  return typeValue === 'ALL' ? palm2024 :
    palm2024.and(palmType.eq(Number(typeValue)));
}

function selectedMask(yearValue, typeValue) {
  var mask = typeMask(typeValue);
  if (yearValue === 'ALL') return mask;
  if (yearValue === 'DATED') return mask.and(plantingYear.gte(1990));
  if (yearValue === 'OLDER_UNKNOWN') return mask.and(evidence.eq(3));
  if (yearValue === 'OTHER_UNKNOWN') return mask.and(evidence.eq(4));
  return mask.and(plantingYear.eq(Number(yearValue)));
}

function areaBands(yearValue, typeValue) {
  var areaHa = ee.Image.pixelArea().divide(10000);
  var base = typeMask(typeValue);
  var bands = [
    areaHa.updateMask(base).rename('fixed_2024_area_ha'),
    areaHa.updateMask(selectedMask(yearValue, typeValue))
      .rename('selected_area_ha')
  ];
  EVIDENCE.forEach(function(item) {
    bands.push(areaHa.updateMask(base.and(evidence.eq(item.code)))
      .rename(item.key));
  });
  return ee.Image.cat(bands);
}

function numberOrZero(feature, key) {
  var value = feature.get(key);
  return ee.Number(ee.Algorithms.If(
    ee.Algorithms.IsEqual(value, null), 0, value));
}

function provinceTable(iso3, yearValue, typeValue) {
  var provinces = gaul.filter(ee.Filter.eq('ISO3_CODE', iso3));
  var reduced = areaBands(yearValue, typeValue).reduceRegions({
    collection: provinces,
    reducer: ee.Reducer.sum(),
    crs: AREA_CRS,
    scale: AREA_SCALE_M,
    tileScale: 8,
    maxPixelsPerRegion: 1000000000
  });
  return reduced.map(function(feature) {
    var row = ee.Feature(null, {
      country_iso3: iso3,
      province_code: feature.get('GAUL1_CODE'),
      province: feature.get('GAUL1_NAME'),
      planting_year_filter: yearValue,
      palm_type_filter: typeValue,
      source_snapshot_year: 2024,
      boundary_vintage: 2025,
      area_sample_scale_m: AREA_SCALE_M,
      interpretation: 'fixed_2024_footprint_point_in_time_crosswalk'
    });
    var classSum = ee.Number(0);
    EVIDENCE.forEach(function(item) {
      var value = numberOrZero(feature, item.key);
      row = row.set(item.key, value);
      classSum = classSum.add(value);
    });
    var total = numberOrZero(feature, 'fixed_2024_area_ha');
    return row.set({
      fixed_2024_area_ha: total,
      selected_area_ha: numberOrZero(feature, 'selected_area_ha'),
      qa_category_sum_ha: classSum,
      qa_closure_delta_ha: classSum.subtract(total)
    });
  });
}

function selectionDescription() {
  var y = yearSelect.getValue();
  var yearText = y === 'ALL' ? 'all 2024-mapped palm' :
    y === 'DATED' ? 'all dated cohorts' :
    y === 'OLDER_UNKNOWN' ? 'older year unresolved' :
    y === 'OTHER_UNKNOWN' ? 'other year code unresolved' :
    y + (Number(y) <= 2015 ? ' (2021 YoP estimate)' :
      ' (TreeMap 2024 annual code)');
  var t = typeSelect.getValue();
  return yearText + ' / ' + (t === 'ALL' ? 'all palm types' :
    t === '1' ? 'industrial' : 'smallholder');
}

var empty = ee.Image.constant(0).selfMask();
var cohortLayer = ui.Map.Layer(empty, {
  min: 1, max: 4, palette: EVIDENCE.map(function(item) {return item.color;})
}, '2024-mapped palm by planting-year evidence', true);
var boundaryLayer = ui.Map.Layer(empty, {}, 'Selected GAUL 2025 boundary', true);
Map.layers().reset([cohortLayer, boundaryLayer]);
Map.setCenter(117, -2, 5);

var countrySelect = ui.Select({
  items: [{label: 'Indonesia (IDN)', value: 'IDN'},
          {label: 'Malaysia (MYS)', value: 'MYS'}],
  value: 'IDN', style: {stretch: 'horizontal'}
});
var provinceSelect = ui.Select({
  items: [{label: 'All provinces / states', value: 'ALL'}],
  value: 'ALL', style: {stretch: 'horizontal'}
});
var yearItems = [
  {label: 'All 2024-mapped palm', value: 'ALL'},
  {label: 'All dated 1990–2024 cohorts', value: 'DATED'},
  {label: '2015 or earlier — year unresolved', value: 'OLDER_UNKNOWN'},
  {label: 'Other 2024 planting code — unresolved', value: 'OTHER_UNKNOWN'}
];
for (var y = 1990; y <= 2024; y++) {
  yearItems.push({
    label: y + (y <= 2015 ? ' — 2021 YoP estimate' :
      ' — TreeMap 2024 annual code'),
    value: String(y)
  });
}
var yearSelect = ui.Select({items: yearItems, value: 'ALL',
  style: {stretch: 'horizontal'}});
var typeSelect = ui.Select({
  items: [{label: 'All palm types', value: 'ALL'},
          {label: 'Industrial', value: '1'},
          {label: 'Smallholder', value: '2'}],
  value: 'ALL', style: {stretch: 'horizontal'}
});
var status = ui.Label('Loading palm map. Area is computed on request.',
  {fontSize: '11px', whiteSpace: 'pre-wrap'});
var areaResult = ui.Label('Area has not been computed.',
  {fontSize: '11px', whiteSpace: 'pre-wrap'});

Map.add(ui.Panel({
  widgets: [
    ui.Label('2024-mapped palm by planting year',
      {fontSize: '16px', fontWeight: 'bold'}),
    ui.Label('Fixed 2024 palm mask · point-in-time 2021/2024 crosswalk',
      {fontSize: '11px', fontWeight: 'bold', color: '#6a502b'}),
    ui.Label('Country'), countrySelect,
    ui.Label('Province / state (GAUL 2025)'), provinceSelect,
    ui.Label('Estimated planting year / evidence'), yearSelect,
    ui.Label('2024 mapped palm type'), typeSelect,
    ui.Button('Compute selected-region area', updateView),
    ui.Button('Chart all provinces / states', showProvinceChart),
    ui.Button('Create province CSV export task', exportProvinceCsv),
    status, areaResult,
    ui.Label('1990–2015 years are 2021 YoP estimates only on TreeMap ' +
      '2024 pixels coded 2015 or earlier. 2016–2024 years come from ' +
      'TreeMap. Missing or conflicting older years stay unresolved. ' +
      'This is not historical or monthly observed extent. ' +
      'Area is a 100 m sampled estimate and can differ from the separate ' +
      '50 m local extraction. Map detail also varies with zoom.',
      {fontSize: '11px', color: '#555555', whiteSpace: 'pre-wrap'})
  ],
  style: {position: 'top-left', width: '350px', padding: '9px'}
}));

var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px',
  backgroundColor: 'ffffffee'}});
var legendTitle = ui.Label('Inferred 2026 age on the 2024 palm mask',
  {fontWeight: 'bold', fontSize: '12px'});
legend.add(legendTitle);
var legendLabels = [];
EVIDENCE.forEach(function(item) {
  var itemLabel = ui.Label(item.label, {fontSize: '11px'});
  legendLabels.push(itemLabel);
  legend.add(ui.Panel({widgets: [
    ui.Label({style: {backgroundColor: '#' + item.color,
      padding: '7px', margin: '0 5px 0 0'}}),
    itemLabel
  ], layout: ui.Panel.Layout.flow('horizontal')}));
});
Map.add(legend);

var chartPanel = ui.Panel({widgets: [
  ui.Label('Province/state chart is computed only on request.')
], style: {position: 'bottom-right', width: '470px', height: '390px',
  padding: '8px', shown: false}});
Map.add(chartPanel);

var provinceRequestId = 0;
var summaryRequestId = 0;
countrySelect.onChange(loadProvinces);
provinceSelect.onChange(renderMap);
yearSelect.onChange(renderMap);
typeSelect.onChange(renderMap);
function loadProvinces() {
  var requestId = ++provinceRequestId;
  ++summaryRequestId;
  var iso3 = countrySelect.getValue();
  renderMap();
  areaResult.setValue('Area has not been computed for this country.');
  chartPanel.style().set('shown', false);
  chartPanel.clear();
  chartPanel.add(ui.Label('Province/state chart is computed only on request.'));
  provinceSelect.setDisabled(true);
  provinceSelect.items().reset([{label: 'All provinces / states', value: 'ALL'}]);
  provinceSelect.setValue('ALL', false);
  status.setValue('Loading GAUL 2025 province/state names for ' + iso3 + '...');
  countryFeatures().reduceColumns({reducer: ee.Reducer.toList(2),
    selectors: ['GAUL1_CODE', 'GAUL1_NAME']})
    .get('list').evaluate(function(rows, error) {
      if (requestId !== provinceRequestId) return;
      if (error || !rows || !rows.length) {
        status.setValue('GAUL province/state lookup failed: ' + error);
        return;
      }
      rows.sort(function(a, b) {return String(a[1]).localeCompare(String(b[1]));});
      var options = [{label: 'All provinces / states', value: 'ALL'}];
      rows.forEach(function(row) {
        options.push({label: row[1], value: String(row[0])});
      });
      provinceSelect.items().reset(options);
      provinceSelect.setValue('ALL', false);
      provinceSelect.setDisabled(false);
      renderMap();
      status.setValue(rows.length + ' provinces/states loaded. Palm pixels are ' +
        'shown; use Compute selected-region area for sampled hectares.');
    });
}

function renderMap() {
  var yearValue = yearSelect.getValue();
  var typeValue = typeSelect.getValue();
  var region = regionFeatures();
  var mask = selectedMask(yearValue, typeValue);
  var overview = yearValue === 'ALL';
  var image = (overview ? directAge2026 : evidence).updateMask(mask);
  // Painting all high-detail GAUL outlines into every tile exhausted the EE
  // map renderer. Nationwide pixels render without a boundary operation.
  var oneRegion = provinceSelect.getValue() !== 'ALL';
  cohortLayer.setEeObject(oneRegion ? image.clipToCollection(region) : image);
  cohortLayer.setName('Fixed 2024 palm: ' + selectionDescription());
  boundaryLayer.setEeObject(oneRegion ? region.style({color: 'ffffff',
    fillColor: '00000000', width: 2}) : empty);
  if (oneRegion) Map.centerObject(region, 7);
  else if (countrySelect.getValue() === 'MYS') Map.setCenter(110, 4, 6);
  else Map.setCenter(117, -2, 5);
  legendTitle.setValue(overview ?
    'Inferred 2026 age on the 2024 palm mask' :
    'Planting-year evidence on the 2024 palm mask');
  var directLabels = ['1–3 years: planted 2023–24; 2025 unavailable',
    '4–10 years: planted 2016–22', '11+ years: planted 2015 or earlier',
    '2024 palm: planting year unresolved'];
  legendLabels.forEach(function(label, i) {
    label.setValue(overview ? directLabels[i] : EVIDENCE[i].label);
  });
}

function updateView() {
  var requestId = ++summaryRequestId;
  renderMap();
  var yearValue = yearSelect.getValue();
  var typeValue = typeSelect.getValue();
  var region = regionFeatures();
  status.setValue('Computing 100 m sampled area...');
  areaResult.setValue('Waiting for area and QA...');
  areaBands(yearValue, typeValue).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: region.geometry(),
    crs: AREA_CRS,
    scale: AREA_SCALE_M,
    maxPixels: 10000000000,
    tileScale: 8
  }).evaluate(function(result, error) {
    if (requestId !== summaryRequestId) return;
    if (error || !result) {
      status.setValue('Area calculation failed: ' + error +
        '. Try one province/state or a CSV batch export.');
      areaResult.setValue('No area result.');
      return;
    }
    var total = Number(result.fixed_2024_area_ha || 0);
    var selected = Number(result.selected_area_ha || 0);
    var categorySum = 0;
    var lines = [
      'Full fixed-2024 area for chosen palm type: ' + total.toFixed(1) + ' ha',
      'Selected filter: ' + selected.toFixed(1) + ' ha'
    ];
    EVIDENCE.forEach(function(item) {
      var area = Number(result[item.key] || 0);
      categorySum += area;
      lines.push(item.label + ': ' + area.toFixed(1) + ' ha');
    });
    var closure = categorySum - total;
    lines.push('QA category sum minus full area: ' + closure.toFixed(3) + ' ha');
    areaResult.setValue(lines.join('\n'));
    status.setValue(selectionDescription() + '. ' +
      (Math.abs(closure) > Math.max(0.1, total * 1e-6) ?
        'WARNING: area closure exceeded tolerance.' : 'Area closure passed.') +
      ' Fixed 2024 footprint; year is a point-in-time crosswalk.');
  });
}

function showProvinceChart() {
  var iso3 = countrySelect.getValue();
  var yearValue = yearSelect.getValue();
  var typeValue = typeSelect.getValue();
  chartPanel.style().set('shown', true);
  chartPanel.clear();
  chartPanel.add(ui.Label('Loading selected-cohort area by province/state...'));
  var table = provinceTable(iso3, yearValue, typeValue);
  var chart = ui.Chart.feature.byFeature(
    table.sort('selected_area_ha', false), 'province', ['selected_area_ha'])
    .setChartType('BarChart')
    .setOptions({title: '2024-mapped cohort area: ' + selectionDescription(),
      legend: {position: 'none'}, hAxis: {title: 'Sampled area (ha)'},
      vAxis: {textStyle: {fontSize: 9}}, height: 340,
      chartArea: {left: 130, right: 12, top: 42, bottom: 40}});
  chartPanel.clear();
  chartPanel.add(chart);
  print('Province/state crosswalk table (sampled hectares and QA)', table);
}

function exportProvinceCsv() {
  var iso3 = countrySelect.getValue();
  var yearValue = yearSelect.getValue();
  var typeValue = typeSelect.getValue();
  var name = 'palm2024_year_crosswalk_' + iso3 + '_' + yearValue +
    '_type' + typeValue;
  var selectors = ['country_iso3', 'province_code', 'province',
    'planting_year_filter', 'palm_type_filter', 'source_snapshot_year',
    'boundary_vintage', 'area_sample_scale_m', 'interpretation',
    'fixed_2024_area_ha', 'selected_area_ha'];
  EVIDENCE.forEach(function(item) {selectors.push(item.key);});
  selectors.push('qa_category_sum_ha', 'qa_closure_delta_ha');
  Export.table.toDrive({
    collection: provinceTable(iso3, yearValue, typeValue),
    description: name,
    fileNamePrefix: name,
    fileFormat: 'CSV',
    selectors: selectors
  });
  status.setValue('Created CSV task ' + name + '. Start it in the Tasks tab. ' +
    'All areas refer to the fixed 2024 palm mask.');
}

loadProvinces();
