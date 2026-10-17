"""
WHAT IT DOES
  Draws the extension icon in two colours only, blue and white: a blue rounded square,
  white selection-corner brackets and a white mouse pointer. Writes one 128 px PNG; the
  browser scales it down for the toolbar.

HOW IT WORKS
  Everything is drawn at 1024x1024, then downsized with LANCZOS filtering, which gives smooth
  (anti-aliased) edges.
  The pointer is drawn as a mask (white = pointer) and its corners are rounded by blurring
  the mask and cutting it again at mid-grey: sharp corners blur away, straight edges stay.
  Around the pointer a ring of background blue is painted first (mask grown with MaxFilter),
  so where the pointer crosses a bracket there is a clean blue gap instead of a third colour.
  Run again after changing the shapes:
    python3 make_icons.py

FILES READ
  none

FILES WRITTEN
  icon128.png (next to this script)
"""

import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
BLUE = (26, 115, 232, 255)   # #1a73e8, same blue as the on-page outline
WHITE = (255, 255, 255, 255)

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=230, fill=BLUE)

# ---- Selection corners: an L at each corner of the box (x0,y0)-(x1,y1), rounded ends.
x0, y0, x1, y1 = 190, 190, 834, 834
arm, w = 200, 84
for cx, cy, dx, dy in [(x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)]:
    for bx, by in [(cx + dx * arm, cy + dy * w), (cx + dx * w, cy + dy * arm)]:  # horizontal, vertical arm
        d.rounded_rectangle((min(cx, bx), min(cy, by), max(cx, bx), max(cy, by)), radius=w // 2, fill=WHITE)

# ---- Pointer: slim modern arrow, tip near the centre, pointing up-left.
# Shape in arrow units (tip at 0,0); one unit = K pixels.
ARROW = [(0, 0), (0, 21), (5.2, 16.2), (8.6, 24.2), (12.0, 22.8), (8.6, 15.0), (15.4, 15.0)]
K, TIP_X, TIP_Y = 19, 450, 420
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).polygon([(TIP_X + x * K, TIP_Y + y * K) for x, y in ARROW], fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(14)).point(lambda v: 255 if v > 127 else 0)  # round corners

gap = mask.filter(ImageFilter.MaxFilter(61))  # pointer grown by 30 px on every side
img.paste(BLUE, (0, 0), gap)
img.paste(WHITE, (0, 0), mask)

here = os.path.dirname(os.path.abspath(__file__))
img.resize((128, 128), Image.LANCZOS).save(os.path.join(here, 'icon128.png'))
print('written: icon128.png')
