import sys

text = open('/tmp/raw_translated.txt', encoding='utf-8').read()
text = text.replace(chr(0x201c), chr(0x5c) + chr(0x22))
text = text.replace(chr(0x201d), chr(0x5c) + chr(0x22))
text = text.replace(chr(0x2018), chr(0x5c) + chr(0x27))
text = text.replace(chr(0x2019), chr(0x5c) + chr(0x27))
print(text, end='')
