Deterministic images generated using ReportLab's EAN13, EAN8 and UPCA writers,
then rasterized from SVG. These encode 7610097171076, 96385074 and 049000006346.
UPC-A includes the full right guard and quiet zone (ReportLab's default drawing
width clips that region). No product image was edited or copied.

PNG files are human-inspectable fixtures. The gzip files contain their RGBA pixels
rotated through 0/90/180/270 degrees. Tests decode these pixels using the exact
production photo decoder, then validate the resulting barcode string.
They test image recognition, not a physical camera or an operating-system picker.
