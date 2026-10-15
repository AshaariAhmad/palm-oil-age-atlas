// Fast source-resolution overview: 2024 TreeMap oil palm, Malaysia + Indonesia.
// Ages shown for 2026 are inferred from planting-year codes in the FIXED 2024
// footprint. Planting in 2025 and land-cover changes after 2024 are unavailable.
var source = ee.ImageCollection(
  'projects/ee-adriadescals/assets/_OP2024/shared/Global_OPExpansion_2015-2024_v20260618');
var raw = source.filterBounds(ee.Geometry.Rectangle([94, -12, 142, 8]))
  .mosaic().select('ABFFYY');
var palmType = raw.divide(100000).floor();
var palm = palmType.eq(1).or(palmType.eq(2));
var yearCode = raw.mod(100);
var cohort = raw.multiply(0).add(4).toByte()
  .where(yearCode.eq(15), 3)
  .where(yearCode.gte(16).and(yearCode.lte(22)), 2)
  .where(yearCode.gte(23).and(yearCode.lte(24)), 1)
  .updateMask(palm);
var colors = ['f5bc43', '009b73', '773391', '808080'];
var layer = ui.Map.Layer(cohort, {min: 1, max: 4, palette: colors},
  '2024 mapped palm · inferred 2026 age', true);
Map.layers().reset([layer]);
Map.setCenter(111, -2, 5);

var focus = ui.Select({items: [
  {label: 'Both countries', value: 'BOTH'},
  {label: 'Malaysia', value: 'MYS'},
  {label: 'Indonesia', value: 'IDN'}
], value: 'BOTH', style: {stretch: 'horizontal'}});
var age = ui.Select({items: [
  {label: 'All palm cohorts', value: 'ALL'},
  {label: '1–3 years · planted 2023–24', value: '1'},
  {label: '4–10 years · planted 2016–22', value: '2'},
  {label: '11+ years · 2015 or earlier', value: '3'},
  {label: 'Planting year unresolved', value: '4'}
], value: 'ALL', style: {stretch: 'horizontal'}});
var kind = ui.Select({items: [
  {label: 'All palm types', value: 'ALL'},
  {label: 'Industrial', value: '1'},
  {label: 'Smallholder', value: '2'}
], value: 'ALL', style: {stretch: 'horizontal'}});

function draw() {
  var image = cohort;
  if (age.getValue() !== 'ALL') image = image.updateMask(
    cohort.eq(Number(age.getValue())));
  if (kind.getValue() !== 'ALL') image = image.updateMask(
    palmType.eq(Number(kind.getValue())));
  layer.setEeObject(image);
  if (focus.getValue() === 'MYS') Map.setCenter(110, 4, 6);
  else Map.setCenter(111, -2, 5);
}
focus.onChange(draw);
age.onChange(draw);
kind.onChange(draw);

Map.add(ui.Panel({widgets: [
  ui.Label('Oil palm only · inferred 2026 age',
    {fontWeight: 'bold', fontSize: '16px'}),
  ui.Label('Source: observed 2024 TreeMap palm pixels. No 2025 planting ' +
    'or 2026 land-cover updates.', {fontSize: '11px', color: '#635637'}),
  ui.Label('Focus'), focus,
  ui.Label('Age cohort'), age,
  ui.Label('Palm type'), kind
], style: {position: 'top-left', width: '310px', padding: '10px'}}));
var legend = ui.Panel({style: {position: 'bottom-right', padding: '8px',
  backgroundColor: 'ffffffee'}});
legend.add(ui.Label('2024 mapped palm · inferred 2026 age',
  {fontWeight: 'bold'}));
var labels = ['1–3 years: 2023–24 observed', '4–10 years: 2016–22',
  '11+ years: 2015 or earlier', 'Planting year unresolved'];
colors.forEach(function(color, i) {
  legend.add(ui.Panel({widgets: [
    ui.Label({style: {backgroundColor: '#' + color,
      padding: '7px', margin: '0 6px 0 0'}}),
    ui.Label(labels[i], {fontSize: '11px'})
  ], layout: ui.Panel.Layout.flow('horizontal')}));
});
Map.add(legend);
