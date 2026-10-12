#!/usr/bin/env python3
"""
Khabzo Office Scanner (V58, monitor V59)  -  makes a list of every device on YOUR office network.

Run it on any computer INSIDE the office network (Windows, Linux or Mac). A website on the internet
cannot see an office network, so this small script does the looking and then sends the list to
/admin/office on your site.

    python3 office_scanner.py --site "Main Office"
    python3 office_scanner.py --site "Main Office" --upload https://YOUR-SITE/office/ingest --token YOUR_TOKEN

What it does (and only this):
  1. pings every address of your own subnet (192.168.x.x / 10.x.x.x / 172.16-31.x.x only)
  2. reads the computer's neighbour (ARP) table to get the MAC address of each device
  3. checks ~22 common ports (printer, camera, Windows, TV...) and reads the public web page banner
  4. guesses the type from the maker of the MAC address + open ports + names
It never logs in, never guesses passwords and never touches anything outside private address ranges.
Only scan a network you own or are allowed to administer (ask the office IT / owner first).

Live monitor (V59): leave this running on one office computer that stays on.

    python3 office_scanner.py --monitor --site "Main Office" --upload https://YOUR-SITE/office/ingest --token YOUR_TOKEN --yes
    sudo python3 office_scanner.py --monitor --dhcp-check ...      # also looks for a second DHCP server (needs admin / root)

Every 5 minutes it pings the subnet and tells the site who is alive (online / slow / offline), which devices
have a 169.254 address (no IP from the router) and, with --dhcp-check, which DHCP servers answer. The site
sends Telegram alerts. Use the same --site name as your scan. It still never logs in or tries passwords.

Needs Python 3.7+ and nothing else (standard library only).
"""
import argparse
import concurrent.futures as cf
import ipaddress
import json
import os
import platform
import random
import re
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

VERSION = '1.1'

PORTS = [21, 22, 23, 80, 135, 139, 443, 445, 515, 554, 631, 3389, 5000, 8000, 8001, 8002, 8008, 8009,
         8080, 8554, 9100, 34567, 37777, 5900, 62078]

OUI_URL = 'https://standards-oui.ieee.org/oui/oui.txt'
OUI_MAX_AGE_DAYS = 90

PRINTER_PORTS = {9100, 515, 631}
CAMERA_PORTS = {554, 8554, 37777, 34567}
MEDIA_PORTS = {8008, 8009, 8001, 8002}
WINDOWS_PORTS = {135, 139, 445, 3389}

PRINTER_VENDORS = ('canon', 'epson', 'brother', 'xerox', 'ricoh', 'kyocera', 'lexmark', 'konica', 'minolta',
                   'okidata', 'oki data', 'pantum', 'toshiba tec', 'fujifilm business', 'fuji xerox', 'zebra',
                   'sharp', 'sindoh', 'develop')
CAMERA_VENDORS = ('hikvision', 'dahua', 'axis communications', 'uniview', 'reolink', 'amcrest', 'foscam',
                  'vivotek', 'hanwha', 'tiandy', 'ezviz', 'imou', 'lorex', 'annke', 'swann', 'geovision',
                  'mobotix', 'avigilon', 'wyze', 'arlo', 'eufy')
NETWORK_VENDORS = ('tp-link', 'tp link', 'netgear', 'd-link', 'dlink', 'ubiquiti', 'mikrotik', 'routerboard',
                   'cisco', 'juniper', 'aruba', 'tenda', 'zyxel', 'huawei', 'zte', 'ruijie', 'linksys', 'cambium',
                   'engenius', 'fiberhome', 'sercomm', 'technicolor', 'arris', 'netis', 'mercusys', 'tplink',
                   'nokia solutions', 'alcatel', 'extreme networks', 'fortinet', 'sophos', 'draytek', 'peplink')
MEDIA_VENDORS = ('lg electronics', 'sony', 'tcl', 'hisense', 'roku', 'vizio', 'sharp electronics', 'philips',
                 'amazon technologies', 'chromecast')
SERVER_VENDORS = ('synology', 'qnap', 'vmware', 'proxmox', 'supermicro', 'xensource', 'qemu', 'virtualbox',
                  'western digital', 'asustor', 'netapp')
PHONE_VENDORS = ('apple', 'samsung', 'xiaomi', 'oppo', 'vivo', 'oneplus', 'realme', 'motorola', 'transsion',
                 'infinix', 'tecno', 'honor', 'nothing technology', 'google', 'fn-link')
COMPUTER_VENDORS = ('intel', 'realtek', 'dell', 'lenovo', 'asustek', 'acer', 'microsoft', 'micro-star', 'msi',
                    'gigabyte', 'liteon', 'azurewave', 'qualcomm', 'hewlett', 'hp inc', 'wistron', 'compal',
                    'quanta', 'pegatron', 'foxconn', 'hon hai', 'toshiba', 'fujitsu', 'rivet networks',
                    'killer', 'giga-byte', 'clevo', 'razer')
PRINTER_TEXT = re.compile(r'printer|laserjet|officejet|deskjet|ecosys|bizhub|imagerunner|workcentre|colorqube|'
                          r'\bmfc-|pixma|ecotank|epson|brother|kyocera|ricoh|lexmark|konica|jetdirect|\bipp\b', re.I)
CAMERA_TEXT = re.compile(r'camera|ip ?cam|hikvision|dahua|\bnvr\b|\bdvr\b|uniview|reolink|ezviz|netsurveillance|'
                         r'web service|dvrdvs|webcam', re.I)
COMPUTER_NAME = re.compile(r'^(desktop|laptop|pc|win|workstation|dell|hp|lenovo|asus)[-_ ]|[-_]pc$|macbook|imac|'
                           r'thinkpad|ubuntu|\bpc\b', re.I)
PHONE_NAME = re.compile(r'iphone|ipad|galaxy|android|pixel|redmi|oppo|vivo|realme|xiaomi|huawei|honor|tecno|infinix', re.I)

PORT_NAMES = {21: 'FTP', 23: 'Telnet', 5900: 'VNC', 22: 'SSH', 80: 'Web', 135: 'Windows RPC', 139: 'NetBIOS', 443: 'Web (HTTPS)', 445: 'Windows file sharing',
              515: 'Print (LPD)', 554: 'Camera stream (RTSP)', 631: 'Print (IPP)', 3389: 'Remote Desktop',
              5000: 'NAS / UPnP', 8000: 'Web (alt)', 8001: 'Samsung TV', 8002: 'Samsung TV', 8008: 'Chromecast',
              8009: 'Chromecast', 8080: 'Web (alt)', 8554: 'Camera stream', 9100: 'Print (JetDirect)',
              34567: 'Camera (XMEye)', 37777: 'Camera (Dahua)', 62078: 'iPhone sync'}

TYPE_LABEL = {'computer': 'Computer', 'printer': 'Printer', 'camera': 'Camera', 'phone': 'Phone / tablet',
              'network': 'Network device', 'media': 'TV / media', 'server': 'Server / NAS', 'unknown': 'Unknown'}


# ---------------------------------------------------------------- helpers
def run(cmd, timeout=8):
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return r.stdout.decode('utf-8', 'ignore')
    except Exception:
        return ''


def is_private_net(net):
    return net.version == 4 and (net.subnet_of(ipaddress.ip_network('10.0.0.0/8'))
                                 or net.subnet_of(ipaddress.ip_network('172.16.0.0/12'))
                                 or net.subnet_of(ipaddress.ip_network('192.168.0.0/16')))


def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))  # no packet is sent; only asks the OS which interface it would use
        return s.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return None
    finally:
        s.close()


def default_gateway():
    system = platform.system().lower()
    if system == 'windows':
        for line in run(['route', 'print', '-4', '0.0.0.0']).splitlines():
            m = re.match(r'\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)', line)
            if m:
                return m.group(1)
    elif system == 'darwin':
        m = re.search(r'gateway:\s*(\d+\.\d+\.\d+\.\d+)', run(['route', '-n', 'get', 'default']))
        if m:
            return m.group(1)
    else:
        m = re.search(r'default via (\d+\.\d+\.\d+\.\d+)', run(['ip', 'route', 'show', 'default']))
        if m:
            return m.group(1)
        m = re.search(r'^0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)', run(['route', '-n']), re.M)
        if m:
            return m.group(1)
    return None


def ping(ip):
    system = platform.system().lower()
    if system == 'windows':
        cmd = ['ping', '-n', '1', '-w', '700', ip]
    elif system == 'darwin':
        cmd = ['ping', '-c', '1', '-W', '700', ip]
    else:
        cmd = ['ping', '-c', '1', '-W', '1', ip]
    try:
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=4)
        return r.returncode == 0
    except Exception:
        return False


MAC_RE = re.compile(r'((?:[0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2})')
IP_RE = re.compile(r'\b(\d{1,3}(?:\.\d{1,3}){3})\b')


def norm_mac(text):
    return ':'.join(p.zfill(2) for p in re.split('[:-]', text)).lower()


def parse_neighbors(text):
    """Works for `ip neigh`, `arp -an` (Linux / Mac) and `arp -a` (Windows)."""
    out = {}
    for line in text.splitlines():
        if re.search(r'incomplete|failed', line, re.I):
            continue
        ip_m, mac_m = IP_RE.search(line), MAC_RE.search(line)
        if not (ip_m and mac_m):
            continue
        mac = norm_mac(mac_m.group(1))
        if mac in ('ff:ff:ff:ff:ff:ff', '00:00:00:00:00:00') or mac.startswith('01:00:5e') or mac.startswith('33:33'):
            continue
        out[ip_m.group(1)] = mac
    return out


def read_neighbors():
    system = platform.system().lower()
    found = {}
    if system not in ('windows', 'darwin'):
        found.update(parse_neighbors(run(['ip', 'neigh'])))
    if not found:
        found.update(parse_neighbors(run(['arp', '-a'] if system == 'windows' else ['arp', '-an'])))
    return found


def is_random_mac(mac):
    return bool(mac) and bool(int(mac[:2], 16) & 2)


# ---------------------------------------------------------------- MAC maker (IEEE list, downloaded once and kept next to the script)
def parse_oui(text):
    table = {}
    for line in text.splitlines():
        m = re.match(r'^([0-9A-F]{2})-([0-9A-F]{2})-([0-9A-F]{2})\s+\(hex\)\s+(.+?)\s*$', line)
        if m:
            table[(m.group(1) + m.group(2) + m.group(3)).lower()] = m.group(4)
    return table


def load_oui(path):
    stale = (not os.path.exists(path)) or (time.time() - os.path.getmtime(path) > OUI_MAX_AGE_DAYS * 86400)
    if stale:
        try:
            print('  Downloading the MAC maker list (one time, ~5 MB)...')
            req = urllib.request.Request(OUI_URL, headers={'User-Agent': 'KhabzoOfficeScanner/' + VERSION})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
        except Exception as e:
            print('  (could not download the maker list: %s). Makers will be missing.' % e)
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return parse_oui(f.read())
    except OSError:
        return {}


# ---------------------------------------------------------------- probing
def probe_port(ip, port, timeout=0.7):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((ip, port)) == 0
    except OSError:
        return False
    finally:
        s.close()


def web_info(ip, ports):
    """Reads only the public front page banner (title, Server header). Never logs in."""
    for port, scheme in ((80, 'http'), (8080, 'http'), (443, 'https'), (8000, 'http'), (5000, 'http')):
        if port not in ports:
            continue
        url = '%s://%s:%d/' % (scheme, ip, port)
        ctx = ssl._create_unverified_context() if scheme == 'https' else None
        title = server = None
        body = b''
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'KhabzoOfficeScanner/' + VERSION})
            with urllib.request.urlopen(req, timeout=2.5, context=ctx) as r:
                server = r.headers.get('Server')
                body = r.read(4096)
        except urllib.error.HTTPError as e:
            server = e.headers.get('Server') if e.headers else None
            realm = re.search(r'realm="?([^",]+)', (e.headers.get('WWW-Authenticate') or '') if e.headers else '')
            title = realm.group(1).strip() if realm else None
            try:
                body = e.read(4096)
            except Exception:
                body = b''
        except Exception:
            continue
        m = re.search(r'<title[^>]*>(.*?)</title>', body.decode('utf-8', 'ignore'), re.I | re.S)
        if m:
            title = re.sub(r'\s+', ' ', m.group(1)).strip() or title
        if title or server:
            return (title or '')[:100] or None, (server or '')[:100] or None
    return None, None


def reverse_name(ip):
    try:
        name = socket.gethostbyaddr(ip)[0]
        return name if name and name != ip else None
    except Exception:
        return None


# ---------------------------------------------------------------- classification (a careful guess, not a certainty)
def has(text, words):
    t = (text or '').lower()
    return any(w in t for w in words)


def classify(d):
    """d: dict with ip, mac, vendor, hostname, ports, web_title, server, is_gateway, random_mac. Returns (type, label)."""
    ports = set(d.get('ports') or [])
    vendor = d.get('vendor') or ''
    host = d.get('hostname') or ''
    web = ' '.join([d.get('web_title') or '', d.get('server') or ''])
    name = host or d.get('web_title') or ''

    if d.get('is_gateway'):
        return 'network', 'Router / gateway' + (' (%s)' % vendor if vendor else '')
    if ports & PRINTER_PORTS or has(vendor, PRINTER_VENDORS) or PRINTER_TEXT.search(web) or PRINTER_TEXT.search(host):
        return 'printer', name or ('Printer' + (' (%s)' % vendor if vendor else ''))
    if ports & CAMERA_PORTS or has(vendor, CAMERA_VENDORS) or CAMERA_TEXT.search(web) or CAMERA_TEXT.search(host):
        return 'camera', name or ('Camera' + (' (%s)' % vendor if vendor else ''))
    if ports & MEDIA_PORTS or has(vendor, MEDIA_VENDORS):
        return 'media', name or ('TV / media device' + (' (%s)' % vendor if vendor else ''))
    if has(vendor, SERVER_VENDORS):
        return 'server', name or ('Server / NAS (%s)' % vendor)
    if has(vendor, NETWORK_VENDORS) and not (ports & WINDOWS_PORTS):
        return 'network', name or ('Router / switch / Wi-Fi (%s)' % vendor)
    if ports & WINDOWS_PORTS or COMPUTER_NAME.search(host):
        return 'computer', name or ('Windows computer' + (' (%s)' % vendor if vendor else ''))
    if 62078 in ports or PHONE_NAME.search(host):
        return 'phone', name or ('iPhone / iPad' if 62078 in ports else 'Phone / tablet')
    if has(vendor, COMPUTER_VENDORS) and not has(vendor, PHONE_VENDORS):
        return 'computer', name or ('Computer (%s)' % vendor)
    if has(vendor, PHONE_VENDORS):
        return 'phone', name or ('Phone / tablet (%s)' % vendor)
    if d.get('random_mac'):
        return 'phone', name or 'Phone / tablet / laptop (random MAC hides the brand)'
    if 22 in ports:
        return 'computer', name or 'Linux computer or server (SSH open)'
    return 'unknown', name or 'Unknown device'


# ---------------------------------------------------------------- scan
def pick_subnet(arg):
    if arg:
        net = ipaddress.ip_network(arg, strict=False)
    else:
        ip = local_ip()
        if not ip:
            sys.exit('Could not find this computer\'s network address. Use --subnet 192.168.1.0/24')
        net = ipaddress.ip_network(ip + '/24', strict=False)
    if not is_private_net(net):
        sys.exit('Refusing to scan %s: only private office networks (192.168.x.x, 10.x.x.x, 172.16-31.x.x) are allowed.' % net)
    if net.prefixlen < 22:
        sys.exit('That subnet is too big (%d addresses). The biggest allowed is a /22 (1024 addresses).' % net.num_addresses)
    return net


def scan(net, site, oui_path, workers=64):
    t0 = time.time()
    hosts = [str(h) for h in net.hosts()]
    me = local_ip()
    gateway = default_gateway()
    print('Scanning %s (%d addresses)...' % (net, len(hosts)))

    print('  [1/4] Finding devices that answer...')
    alive = set()
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for ip, ok in zip(hosts, ex.map(ping, hosts)):
            if ok:
                alive.add(ip)
    neighbors = {ip: mac for ip, mac in read_neighbors().items() if ip in set(hosts)}
    live = sorted(set(neighbors) | alive | ({me} if me in set(hosts) else set()), key=lambda x: ipaddress.ip_address(x))

    print('  [2/4] Checking ports on %d devices...' % len(live))
    open_ports = {ip: [] for ip in live}
    pairs = [(ip, p) for ip in live for p in PORTS]
    with cf.ThreadPoolExecutor(max_workers=96) as ex:
        for (ip, p), ok in zip(pairs, ex.map(lambda a: probe_port(*a), pairs)):
            if ok:
                open_ports[ip].append(p)

    print('  [3/4] Reading names and web pages...')
    names, webs = {}, {}
    with cf.ThreadPoolExecutor(max_workers=32) as ex:
        nf = {ip: ex.submit(reverse_name, ip) for ip in live}
        wf = {ip: ex.submit(web_info, ip, open_ports[ip]) for ip in live}
        for ip in live:
            try:
                names[ip] = nf[ip].result(timeout=4)
            except Exception:
                names[ip] = None
            try:
                webs[ip] = wf[ip].result(timeout=12)
            except Exception:
                webs[ip] = (None, None)

    print('  [4/4] Working out what each device is...')
    oui = load_oui(oui_path)
    my_mac = None
    try:
        node = uuid.getnode()
        if not (node >> 40) & 1:  # not a random number made by Python
            my_mac = ':'.join('%02x' % ((node >> s) & 0xff) for s in range(40, -1, -8))
    except Exception:
        pass

    devices = []
    for ip in live:
        mac = neighbors.get(ip) or (my_mac if ip == me else None)
        rnd = is_random_mac(mac)
        vendor = None
        if mac and not rnd:
            vendor = oui.get(mac.replace(':', '')[:6])
        title, server = webs[ip]
        d = {'ip': ip, 'mac': mac, 'vendor': vendor, 'hostname': names[ip], 'ports': sorted(open_ports[ip]),
             'web_title': title, 'server': server, 'is_self': ip == me, 'is_gateway': ip == gateway, 'random_mac': rnd}
        d['type'], d['label'] = classify(d)
        devices.append(d)

    print('Done in %.0f seconds.' % (time.time() - t0))
    return {'version': 1, 'site': site, 'subnet': str(net), 'scanner': socket.gethostname(),
            'scanned_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'devices': devices}


def demo(site):
    rows = [
        ('192.168.1.1', '50:c7:bf:11:22:01', 'TP-Link Technologies', 'Router', [80, 443], 'network', 'Router / gateway (TP-Link)', True, False),
        ('192.168.1.10', '3c:52:82:aa:01:10', 'HP Inc.', 'DESKTOP-ACC01', [135, 139, 445], 'computer', 'DESKTOP-ACC01', False, False),
        ('192.168.1.11', '84:2b:2b:aa:01:11', 'Dell Inc.', 'LAPTOP-HR02', [135, 445], 'computer', 'LAPTOP-HR02', False, False),
        ('192.168.1.12', 'a4:4c:c8:aa:01:12', 'Intel Corporate', None, [], 'computer', 'Computer (Intel Corporate)', False, False),
        ('192.168.1.20', '00:1b:a9:aa:02:20', 'Brother Industries', 'BRN001BA9', [80, 515, 631, 9100], 'printer', 'Brother HL-L2350DW', False, False),
        ('192.168.1.21', '00:00:48:aa:02:21', 'Seiko Epson', None, [80, 631, 9100], 'printer', 'EPSON L3150 Series', False, False),
        ('192.168.1.30', 'bc:ad:28:aa:03:30', 'Hangzhou Hikvision', None, [80, 554, 8000], 'camera', 'Camera (Hangzhou Hikvision)', False, False),
        ('192.168.1.31', '4c:11:bf:aa:03:31', 'Zhejiang Dahua', None, [80, 554, 37777], 'camera', 'Camera (Zhejiang Dahua)', False, False),
        ('192.168.1.40', '02:5a:11:aa:04:40', None, 'Galaxy-A52', [], 'phone', 'Galaxy-A52', False, True),
        ('192.168.1.41', 'f0:18:98:aa:04:41', 'Apple, Inc.', 'Alis-iPhone', [62078], 'phone', 'Alis-iPhone', False, False),
        ('192.168.1.50', '6c:5a:b0:aa:05:50', 'TCL King Electrical', None, [8008, 8009], 'media', 'TV / media device (TCL)', False, False),
    ]
    devs = []
    for ip, mac, vendor, host, ports, typ, label, gw, rnd in rows:
        devs.append({'ip': ip, 'mac': mac, 'vendor': vendor, 'hostname': host, 'ports': ports, 'web_title': None,
                     'server': None, 'is_self': False, 'is_gateway': gw, 'random_mac': rnd, 'type': typ, 'label': label})
    return {'version': 1, 'site': site + ' (DEMO)', 'subnet': '192.168.1.0/24', 'scanner': 'demo',
            'scanned_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'devices': devs}


# ---------------------------------------------------------------- live monitor (V59)
def ping_rtt(ip):
    """Returns (answered, milliseconds or None)."""
    system = platform.system().lower()
    if system == 'windows':
        cmd = ['ping', '-n', '1', '-w', '1000', ip]
    elif system == 'darwin':
        cmd = ['ping', '-c', '1', '-W', '1000', ip]
    else:
        cmd = ['ping', '-c', '1', '-W', '1', ip]
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
    except Exception:
        return False, None
    out = r.stdout.decode('utf-8', 'ignore')
    if r.returncode != 0 or re.search(r'unreachable|timed out|100% (packet )?loss', out, re.I) and not re.search(r'time[=<]', out):
        return False, None
    m = re.search(r'time[=<]\s*([\d.]+)\s*ms', out, re.I)
    if m:
        return True, float(m.group(1))
    return True, 1.0 if re.search(r'time<', out) else None


def tcp_alive(ip):
    """A device that blocks ping still answers a TCP knock (even a refusal means it is there)."""
    for port in (445, 80, 443, 22):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.6)
        t0 = time.time()
        try:
            code = s.connect_ex((ip, port))
            if code == 0 or code in (111, 10061, 61, 54):  # connected / refused (Linux, Windows, Mac)
                return True, round((time.time() - t0) * 1000, 1)
        except OSError:
            pass
        finally:
            s.close()
    return False, None


def link_local_neighbors():
    """169.254.x.x devices seen in the ARP table: they could not get an address from the router."""
    system = platform.system().lower()
    text = run(['arp', '-a'] if system == 'windows' else ['ip', 'neigh']) if system != 'darwin' else run(['arp', '-an'])
    if not text.strip() and system not in ('windows', 'darwin'):
        text = run(['arp', '-an'])
    out = {}
    for line in text.splitlines():
        if re.search(r'incomplete|failed', line, re.I):
            continue
        ip_m, mac_m = IP_RE.search(line), MAC_RE.search(line)
        if ip_m and mac_m and ip_m.group(1).startswith('169.254.'):
            out[ip_m.group(1)] = norm_mac(mac_m.group(1))
    return [{'ip': ip, 'mac': mac} for ip, mac in list(out.items())[:50]]


def dhcp_probe(wait=4.0):
    """Sends ONE DHCP "discover" broadcast and listens for answers. Needs admin / root (port 68).
    Returns {'ran': bool, 'servers': [ip, ...], 'error': str or None}. It only listens; it never accepts an address."""
    xid = random.getrandbits(32)
    mac = bytes([0x02, 0x00, 0x5e] + [random.getrandbits(8) for _ in range(3)])  # made-up locally administered MAC
    pkt = struct.pack('!BBBBIHH4s4s4s4s16s64s128s', 1, 1, 6, 0, xid, 0, 0x8000, b'\0' * 4, b'\0' * 4, b'\0' * 4, b'\0' * 4,
                      mac + b'\0' * 10, b'\0' * 64, b'\0' * 128)
    pkt += b'\x63\x82\x53\x63' + b'\x35\x01\x01' + b'\x37\x03\x01\x03\x06' + b'\xff'  # magic cookie, DISCOVER, params, end
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    servers = []
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            s.bind(('', 68))
        except OSError as e:
            return {'ran': False, 'servers': [], 'error': 'cannot listen on port 68 (run as administrator / sudo, or another DHCP client is using it): %s' % e}
        s.sendto(pkt, ('255.255.255.255', 67))
        end = time.time() + wait
        while time.time() < end:
            s.settimeout(max(0.1, end - time.time()))
            try:
                data, addr = s.recvfrom(1500)
            except socket.timeout:
                break
            if len(data) < 241 or data[0] != 2 or struct.unpack('!I', data[4:8])[0] != xid or data[236:240] != b'\x63\x82\x53\x63':
                continue
            srv = socket.inet_ntoa(data[20:24]) if data[20:24] != b'\0' * 4 else addr[0]
            i = 240
            while i < len(data) and data[i] != 255:  # option 54 = server identifier
                if data[i] == 0:
                    i += 1
                    continue
                if i + 1 >= len(data):
                    break
                ln = data[i + 1]
                if data[i] == 54 and ln == 4:
                    srv = socket.inet_ntoa(data[i + 2:i + 6])
                i += 2 + ln
            if srv not in servers:
                servers.append(srv)
        return {'ran': True, 'servers': servers, 'error': None}
    except Exception as e:
        return {'ran': False, 'servers': servers, 'error': str(e)[:120]}
    finally:
        s.close()


def heartbeat_url(args):
    if args.heartbeat:
        return args.heartbeat
    if args.upload:
        return re.sub(r'/office/ingest/?$', '/office/heartbeat', args.upload.strip())
    return None


def monitor_once(net, site, interval, cache, oui, dhcp=None):
    hosts = [str(h) for h in net.hosts()]
    hostset = set(hosts)
    me = local_ip()
    gateway = default_gateway()
    results = {}
    with cf.ThreadPoolExecutor(max_workers=64) as ex:
        for ip, res in zip(hosts, ex.map(ping_rtt, hosts)):
            if res[0]:
                results[ip] = res[1]
    neighbors = {ip: mac for ip, mac in read_neighbors().items() if ip in hostset}
    maybe = [ip for ip in neighbors if ip not in results]  # in the ARP table but ignored ping: knock on TCP ports
    if maybe:
        with cf.ThreadPoolExecutor(max_workers=32) as ex:
            for ip, res in zip(maybe, ex.map(tcp_alive, maybe)):
                if res[0]:
                    results[ip] = res[1]
    if me in hostset:
        results.setdefault(me, 0.0)
    need = [ip for ip in results if ip not in cache]
    if need:
        with cf.ThreadPoolExecutor(max_workers=32) as ex:
            for ip, nm in zip(need, ex.map(reverse_name, need)):
                cache[ip] = nm or ''
    my_mac = None
    try:
        node = uuid.getnode()
        if not (node >> 40) & 1:
            my_mac = ':'.join('%02x' % ((node >> sh) & 0xff) for sh in range(40, -1, -8))
    except Exception:
        pass
    devices = []
    for ip in sorted(results, key=lambda x: ipaddress.ip_address(x)):
        mac = neighbors.get(ip) or (my_mac if ip == me else None)
        vendor = oui.get(mac.replace(':', '')[:6]) if mac and not is_random_mac(mac) else None
        devices.append({'ip': ip, 'mac': mac, 'rtt': results[ip], 'self': ip == me, 'vendor': vendor, 'name': cache.get(ip) or None})
    beat = {'version': 1, 'site': site, 'host': socket.gethostname(), 'subnet': str(net), 'gateway': gateway,
            'interval': interval, 'sent_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'devices': devices, 'link_local': link_local_neighbors()}
    if dhcp is not None:
        beat['dhcp'] = dhcp
    return beat


def monitor(args):
    net = pick_subnet(args.subnet)
    url = heartbeat_url(args)
    if url and not args.token:
        sys.exit('Monitor needs --token (or set the OFFICE_SCAN_TOKEN environment variable).')
    if not args.yes:
        print('About to watch %s every %d seconds.\nOnly watch a network you own or are allowed to administer.' % (net, args.every))
        if input('Continue? [y/N] ').strip().lower() not in ('y', 'yes'):
            sys.exit('Cancelled.')
    if not url:
        print('(no --upload given: results are only printed, nothing is sent to your site)')
    oui = load_oui(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'oui.txt'))
    cache = {}
    n = 0
    print('Monitoring %s as "%s". Press Ctrl+C to stop.' % (net, args.site))
    while True:
        t0 = time.time()
        try:
            dhcp = dhcp_probe() if args.dhcp_check and n % max(1, args.dhcp_every) == 0 else None
            beat = monitor_once(net, args.site, args.every, cache, oui, dhcp)
            msg = '%s  %d devices answered' % (datetime.now().strftime('%H:%M:%S'), len(beat['devices']))
            if dhcp is not None:
                msg += ' | DHCP: ' + (('%d server(s) %s' % (len(dhcp['servers']), ', '.join(dhcp['servers']))) if dhcp['ran'] else 'not checked (%s)' % dhcp['error'])
            if beat['link_local']:
                msg += ' | %d device(s) with 169.254 address' % len(beat['link_local'])
            if url:
                body = json.dumps(beat).encode('utf-8')
                req = urllib.request.Request(url, data=body, method='POST', headers={
                    'Content-Type': 'application/json', 'Authorization': 'Bearer ' + args.token, 'User-Agent': 'KhabzoOfficeScanner/' + VERSION})
                try:
                    with urllib.request.urlopen(req, timeout=30) as r:
                        msg += ' | sent: ' + r.read().decode('utf-8', 'ignore')[:120]
                except urllib.error.HTTPError as e:
                    msg += ' | SEND FAILED (HTTP %d): %s' % (e.code, e.read().decode('utf-8', 'ignore')[:150])
                except Exception as e:
                    msg += ' | SEND FAILED: %s' % e
            print(msg)
            n += 1
        except KeyboardInterrupt:
            raise
        except Exception as e:  # one bad round must not stop the monitor
            print('%s  round failed: %s' % (datetime.now().strftime('%H:%M:%S'), e))
        time.sleep(max(5, args.every - (time.time() - t0)))


# ---------------------------------------------------------------- output
def print_report(result):
    devs = result['devices']
    counts = {}
    for d in devs:
        counts[d['type']] = counts.get(d['type'], 0) + 1
    print('\n' + '=' * 78)
    print('%s  |  %s  |  %d devices' % (result['site'], result['subnet'], len(devs)))
    print('=' * 78)
    for t in ('computer', 'printer', 'camera', 'phone', 'network', 'media', 'server', 'unknown'):
        if t in counts:
            print('  %-16s %d' % (TYPE_LABEL[t], counts[t]))
    print('-' * 78)
    print('%-15s %-17s %-14s %s' % ('IP', 'MAC', 'TYPE', 'NAME / MAKER'))
    for d in devs:
        extra = ' [%s]' % d['vendor'] if d.get('vendor') and d['vendor'] not in (d.get('label') or '') else ''
        flag = ' (this computer)' if d.get('is_self') else ''
        print('%-15s %-17s %-14s %s%s%s' % (d['ip'], d.get('mac') or '-', TYPE_LABEL.get(d['type'], d['type']),
                                          d.get('label') or '-', extra, flag))
    print('=' * 78)
    print('This is a careful guess from the MAC maker, open ports and names. Phones with a random MAC and '
          'devices that are switched off cannot be named.')


def upload(result, url, token):
    body = json.dumps(result).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'User-Agent': 'KhabzoOfficeScanner/' + VERSION})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print('Uploaded: ' + r.read().decode('utf-8', 'ignore')[:200])
            return True
    except urllib.error.HTTPError as e:
        print('Upload failed (HTTP %d): %s' % (e.code, e.read().decode('utf-8', 'ignore')[:200]))
    except Exception as e:
        print('Upload failed: %s' % e)
    return False


def main():
    ap = argparse.ArgumentParser(description='List every device on your office network and send it to your site.')
    ap.add_argument('--site', default='Office', help='name of this office / place (default: Office)')
    ap.add_argument('--subnet', help='for example 192.168.1.0/24 (default: this computer\'s /24)')
    ap.add_argument('--upload', metavar='URL', help='https://YOUR-SITE/office/ingest')
    ap.add_argument('--token', default=os.environ.get('OFFICE_SCAN_TOKEN'), help='same value as OFFICE_SCAN_TOKEN on the site')
    ap.add_argument('--out', default='office_scan.json', help='file to save the result (default office_scan.json)')
    ap.add_argument('--yes', action='store_true', help='do not ask for confirmation')
    ap.add_argument('--monitor', action='store_true', help='keep running: every few minutes tell the site who is online (V59)')
    ap.add_argument('--every', type=int, default=300, metavar='SECONDS', help='monitor: seconds between checks (60-3600, default 300)')
    ap.add_argument('--heartbeat', metavar='URL', help='monitor: https://YOUR-SITE/office/heartbeat (default: made from --upload)')
    ap.add_argument('--dhcp-check', action='store_true', help='monitor: also look for a second DHCP server (needs administrator / sudo)')
    ap.add_argument('--dhcp-every', type=int, default=12, metavar='N', help='monitor: DHCP check once every N rounds (default 12 = hourly)')
    ap.add_argument('--demo', action='store_true', help='make a made-up list (no scanning) to preview the admin page')
    args = ap.parse_args()
    args.every = min(3600, max(60, args.every))

    if args.monitor:
        try:
            monitor(args)
        except KeyboardInterrupt:
            print('\nMonitor stopped.')
        return

    if args.demo:
        result = demo(args.site)
    else:
        net = pick_subnet(args.subnet)
        if not args.yes:
            print('About to scan %s.\nOnly scan a network you own or are allowed to administer.' % net)
            if input('Continue? [y/N] ').strip().lower() not in ('y', 'yes'):
                sys.exit('Cancelled.')
        result = scan(net, args.site, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'oui.txt'))

    print_report(result)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=1)
    print('\nSaved to %s' % args.out)
    if args.upload:
        if not args.token:
            sys.exit('Upload needs --token (or set the OFFICE_SCAN_TOKEN environment variable).')
        upload(result, args.upload, args.token)
    else:
        print('To send it to your site: add --upload https://YOUR-SITE/office/ingest --token YOUR_TOKEN\n'
              'or paste the saved file into Admin > Office devices > "Import a scan file".')


if __name__ == '__main__':
    main()
