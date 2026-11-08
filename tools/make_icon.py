"""Erzeugt das App-Icon: Sprechblase mit Prompt-Zeichen auf ARFEP-Blau."""
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=230, fill="#1581FF")
# Sprechblase
d.rounded_rectangle((200, 230, 824, 700), radius=120, fill="white")
d.polygon([(300, 660), (300, 840), (470, 690)], fill="white")
# >_
w = 64
d.line([(330, 360), (450, 465), (330, 570)], fill="#1581FF", width=w, joint="curve")
for x, y in [(330, 360), (450, 465), (330, 570)]:
    d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill="#1581FF")
d.rounded_rectangle((510, 535, 700, 535 + w), radius=w // 2, fill="#1581FF")

img.save("build/icon.png")
img.save("build/icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
img.resize((256, 256), Image.LANCZOS).save("src/renderer/assets/icon.png")
