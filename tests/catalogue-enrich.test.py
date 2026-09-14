import importlib.util, pathlib, unittest
spec = importlib.util.spec_from_file_location('enrich', pathlib.Path('scripts/enrich-swiss-catalogue.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class EnrichTest(unittest.TestCase):
 def test_barcode_key_strips_padding(self):
  self.assertEqual(m.barcode_key('07610200011435'), m.barcode_key('7610200011435'))
  self.assertEqual(m.gtin('7610200011435'), '7610200011435')
  self.assertIsNone(m.gtin('277610807057287000000100'))

 def test_photos_prefer_front_then_ingredients(self):
  row = {
   'image_url': '',
   'image_small_url': '',
   'image_ingredients_url': 'https://images.openfoodfacts.org/images/products/000/013/002/8030/ingredients_de.4.400.jpg',
   'image_nutrition_url': 'https://images.openfoodfacts.org/images/products/000/013/002/8030/nutrition_de.4.400.jpg',
  }
  self.assertTrue(m.pick_image(row).endswith('ingredients_de.4.400.jpg'))
  self.assertIsNone(m.off_image('http://example.com/x.jpg'))

 def test_ingredients_use_text_then_taxonomy(self):
  text, source = m.ingredients_from_row({'ingredients_text': 'oats, sugar'})
  self.assertEqual(source, 'open-food-facts-text')
  self.assertEqual(text, 'oats, sugar')
  text, source = m.ingredients_from_row({'ingredients_tags': 'en:oats,en:sugar'})
  self.assertEqual(source, 'open-food-facts-taxonomy')
  self.assertEqual(text, 'oats, sugar')

 def test_assign_codes_keeps_pack_identifiers(self):
  product = {}
  m.assign_codes(product, '277610807057287000000100')
  self.assertEqual(product['sourceIdentifier'], '277610807057287000000100')
  self.assertNotIn('barcode', product)
  product = {}
  m.assign_codes(product, '7610200011435')
  self.assertEqual(product['barcode'], '7610200011435')

 def test_off_image_path_keeps_leading_zeros(self):
  spec = importlib.util.spec_from_file_location('merge', pathlib.Path('scripts/merge-off-jsonl.py'))
  merge = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(merge)
  self.assertEqual(merge.barcode_image_path('0000130028030'), '000/013/002/8030')
  self.assertEqual(merge.barcode_image_path('130028030'), '000/013/002/8030')
  self.assertEqual(merge.barcode_image_path('00025393'), '00025393')
  self.assertEqual(merge.barcode_image_path('7610200011435'), '761/020/001/1435')
  self.assertTrue(merge.uploaded_image_url('7610145651055', {'1': {'sizes': {'400': {'w': 400}}}}).endswith('/1.400.jpg'))
  self.assertTrue(merge.numeric_uploaded_url('7610177004508', {'1': {'sizes': {'400': {'w': 400}}}, 'front_de': {'rev': '6'}}).endswith('/1.400.jpg'))
  self.assertTrue(merge.named_image_url('2102738006205', {'front_de': {'rev': '6', 'sizes': {'400': {}}}}, 'front').endswith('front_de.6.400.jpg'))

 def test_ocr_keeps_lists_and_rejects_noise(self):
  spec = importlib.util.spec_from_file_location('ocr', pathlib.Path('scripts/ocr-catalogue-ingredients.py'))
  ocr = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(ocr)
  self.assertTrue(ocr.useful('Zutaten: Hafervollkorn, Zucker, Palmöl, Salz'))
  self.assertFalse(ocr.useful('TN 42 pack photo'))
  self.assertFalse(ocr.useful('FOOD FACTS 100 g enthalten Energiewert 1460 kJ (345kcal), Eiweiss 8 g, Kohlenhydrate 74g'))
  self.assertFalse(ocr.useful('Nährwerte | valeurs nutritives | 100 g, Fett 10g, davon gesättigte Fettsäuren'))
  self.assertIn('Hafervollkorn', ocr.clean_ocr('Zutaten: Hafervollkorn, Zucker'))

if __name__ == '__main__':
 unittest.main()

