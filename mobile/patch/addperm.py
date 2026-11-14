"""Add <uses-permission android:name="..."/> elements to a compiled AndroidManifest.xml.

Each new element is a copy of the INTERNET one with its name pointed at a new string appended to the string pool:
appending keeps every existing string index (and the resource map, which covers only attribute names at the front of
the pool) exactly as it was. Usage: addperm.py in.xml out.xml PERMISSION [PERMISSION...]
"""
import struct, sys

def u32(b, o): return struct.unpack_from('<I', b, o)[0]

def pool_strings(buf, off):
    typ, hsz, size, count, styles, flags, sstart, stystart = struct.unpack_from('<HHIIIIII', buf, off)
    assert typ == 0x0001
    utf8 = bool(flags & 0x100)
    offs = list(struct.unpack_from('<%dI' % count, buf, off + hsz))
    out = []
    for o in offs:
        p = off + sstart + o
        if utf8:
            n = buf[p]; p += 2 if n & 0x80 else 1
            n8 = buf[p]
            if n8 & 0x80: n8 = ((n8 & 0x7f) << 8) | buf[p + 1]; p += 2
            else: p += 1
            out.append(buf[p:p + n8].decode('utf8'))
        else:
            n = struct.unpack_from('<H', buf, p)[0]; p += 2
            out.append(buf[p:p + 2 * n].decode('utf-16le'))
    return dict(typ=typ, hsz=hsz, size=size, count=count, styles=styles, flags=flags, sstart=sstart,
                stystart=stystart, utf8=utf8, offs=offs, strings=out)

def encode(s, utf8):
    if utf8:
        b = s.encode('utf8'); assert len(s) < 128 and len(b) < 128
        return bytes([len(s), len(b)]) + b + b'\0'
    return struct.pack('<H', len(s)) + s.encode('utf-16le') + b'\0\0'

def add_strings(buf, news):
    """Returns (new buffer, {string: index}) with `news` appended to the pool."""
    P = pool_strings(buf, 8)
    assert P['styles'] == 0, 'styled string pools are not handled'
    off = 8
    data_start = off + P['sstart']
    data_end = off + P['size']
    data = bytes(buf[data_start:data_end]).rstrip(b'\0') if False else bytes(buf[data_start:data_end])
    # The used part of the data: up to the end of the last string, then our strings, then padding to 4.
    last = max(range(P['count']), key=lambda i: P['offs'][i])
    lp = data_start + P['offs'][last]
    if P['utf8']:
        n = buf[lp]; q = lp + (2 if n & 0x80 else 1)
        n8 = buf[q]
        if n8 & 0x80: n8 = ((n8 & 0x7f) << 8) | buf[q + 1]; q += 2
        else: q += 1
        used = q + n8 + 1 - data_start
    else:
        n = struct.unpack_from('<H', buf, lp)[0]
        used = 2 + 2 * n + 2 + (lp - data_start)
    body = bytearray(data[:used])
    index = {}
    new_offs = list(P['offs'])
    for s in news:
        if s in P['strings']: index[s] = P['strings'].index(s); continue
        new_offs.append(len(body)); index[s] = len(new_offs) - 1
        body += encode(s, P['utf8'])
    while len(body) % 4: body += b'\0'
    count = len(new_offs)
    sstart = P['hsz'] + 4 * count
    chunk = bytearray(struct.pack('<HHIIIIII', 0x0001, P['hsz'], 0, count, 0, P['flags'], sstart, 0))
    chunk += b'\0' * (P['hsz'] - len(chunk))
    chunk += struct.pack('<%dI' % count, *new_offs)
    chunk += body
    struct.pack_into('<I', chunk, 4, len(chunk))
    out = bytearray(buf[:8]) + chunk + buf[off + P['size']:]
    struct.pack_into('<I', out, 4, len(out))
    return out, index

def elements(buf):
    P = pool_strings(buf, 8)
    off = 8 + P['size']
    found = []
    while off < len(buf):
        typ, hsz, size = struct.unpack_from('<HHI', buf, off)
        if typ in (0x0102, 0x0103):
            ns, name = struct.unpack_from('<ii', buf, off + 16)
            found.append((typ, off, size, P['strings'][name]))
        off += size
    return P, found

def main():
    src, dst, *perms = sys.argv[1:]
    buf = bytearray(open(src, 'rb').read())
    P, els = elements(buf)
    have = set()
    for typ, off, size, name in els:
        if typ == 0x0102 and name == 'uses-permission':
            raw = struct.unpack_from('<i', buf, off + 16 + 20 + 8)[0]
            have.add(P['strings'][raw] if raw >= 0 else None)
    perms = [p for p in perms if p not in have]
    if not perms: print('nothing to add'); open(dst, 'wb').write(buf); return
    buf, index = add_strings(buf, perms)
    P, els = elements(buf)
    # The INTERNET element, and its end, to copy.
    start = end = None
    for i, (typ, off, size, name) in enumerate(els):
        if typ == 0x0102 and name == 'uses-permission':
            raw = struct.unpack_from('<i', buf, off + 16 + 20 + 8)[0]
            if raw >= 0 and P['strings'][raw] == 'android.permission.INTERNET':
                start = (off, size); end = els[i + 1]; assert end[0] == 0x0103 and end[3] == 'uses-permission'
    assert start, 'no INTERNET permission to copy'
    s_off, s_size = start
    _, e_off, e_size, _ = end
    tmpl_start = bytes(buf[s_off:s_off + s_size]); tmpl_end = bytes(buf[e_off:e_off + e_size])
    # One attribute, android:name, a string.
    acount = struct.unpack_from('<H', tmpl_start, 16 + 12)[0]
    assert acount == 1, f'expected one attribute, found {acount}'
    add = bytearray()
    for p in perms:
        el = bytearray(tmpl_start)
        a = 16 + 20
        struct.pack_into('<i', el, a + 8, index[p])          # rawValue
        assert el[a + 15] == 0x03                             # dataType: string
        struct.pack_into('<I', el, a + 16, index[p])          # data
        add += el + tmpl_end
    at = e_off + e_size
    buf = buf[:at] + add + buf[at:]
    struct.pack_into('<I', buf, 4, len(buf))
    open(dst, 'wb').write(buf)
    P2, els2 = elements(buf)
    got = []
    for typ, off, size, name in els2:
        if typ == 0x0102 and name == 'uses-permission':
            raw = struct.unpack_from('<i', buf, off + 16 + 20 + 8)[0]
            got.append(P2['strings'][raw])
    for p in perms: assert p in got, p
    print('permissions now:', ', '.join(x.replace('android.permission.', '') for x in got))

main()
