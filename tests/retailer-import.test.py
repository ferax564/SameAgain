import unittest,importlib.util,pathlib
spec=importlib.util.spec_from_file_location('importer','scripts/import-retailer-pages.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ImportTest(unittest.TestCase):
 def page(self,body):return {'url':'https://www.migros.ch/de/product/000123456789','retrieved':1,'html':'<h1 data-testid="product-detail-1-title">Test oats</h1>'+body}
 def test_units_and_missing_declarations(self):
  p=m.parse_page(self.page('<span data-testid="product-detail-1-weight">500 g</span><dd data-testid="product-detail-1-ingredients">Oats, <strong>milk</strong></dd><table><tr><th>Nährstoff</th><th>100 g</th></tr><tr><td>Fett</td><td>2,5 g</td></tr><tr><td>Eiweiss</td><td>&lt;0.1 g</td></tr><tr><td>Energiewert in kJ</td><td>418.4 kJ</td></tr></table>'))
  self.assertEqual(p['id'],'migros:000123456789');self.assertEqual(p['pack'],'500 g');self.assertEqual(p['nutrition']['fat'],2.5);self.assertEqual(p['nutrition']['energy-kcal'],100);self.assertNotIn('proteins',p['nutrition']);self.assertNotIn('allergens',p);self.assertNotIn('barcode',p)
 def test_serving_basis_and_error_pages_not_imported(self):
  p=m.parse_page(self.page('<table><tr><th>Nährstoff</th><th>Serving</th></tr><tr><td>Fett</td><td>2 g</td></tr></table>'));self.assertNotIn('nutrition',p)
  self.assertIsNone(m.parse_page({'url':'https://www.migros.ch/de/product/123','retrieved':1,'html':'<h1>Access denied</h1>'}))
unittest.main()
