import json, urllib.request, http.cookiejar, uuid, sys
B='http://127.0.0.1:32151/api/v1'
def client(email,pw):
    cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    def call(method,path,body=None):
        req=urllib.request.Request(B+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'content-type':'application/json','idempotency-key':str(uuid.uuid4())})
        try:
            r=op.open(req); return r.status, json.loads(r.read() or b'null')
        except urllib.error.HTTPError as e:
            raw=e.read()
            try: return e.code, json.loads(raw)
            except Exception: return e.code, {'raw':raw[:200].decode(errors='ignore')}
    s,b=call('POST','/auth/password/sessions',{'email':email,'password':pw,'channel':'WEB'})
    assert s==200,(email,s,b)
    return call
P=lambda n:f'a0a0a0a0-3333-4000-8000-0000000000{n:02d}'
S=lambda c:'a0a0a0a0-4444-4000-8000-'+c.rjust(12,'0')
def code(b):
    if isinstance(b,dict):
        if 'code' in b: return b['code']
        if 'error' in b and isinstance(b['error'],dict): return b['error'].get('code')
        if 'body' in b and isinstance(b['body'],dict) and 'bookingNumber' in b['body']: return 'OK '+b['body']['bookingNumber']
        if 'bookingNumber' in b: return 'OK '+b['bookingNumber']
        if 'booking' in b and isinstance(b['booking'],dict) and 'bookingNumber' in b['booking']: return 'OK '+b['booking']['bookingNumber']
    return str(b)[:80]
rows=[]
def rec(id_,desc,expected,actual): 
    ok = expected in actual
    rows.append((id_,desc,expected,actual,'LULUS' if ok else 'GAGAL'))
    print(f"{id_:6} {'LULUS' if ok else 'GAGAL':6} harapan={expected:32} hasil={actual}  | {desc}")
def book(c,pkg,slot): 
    s,b=c('POST','/bookings',{'classSlotId':slot,'customerPackageId':pkg,'source':'SELF'}); return s,code(b)
def opts(c,slot):
    s,b=c('GET','/bookings/options/'+slot); 
    if s!=200: return s,None,str(b)[:80]
    return s,[p['customerPackageId'] for p in b['packages']],b['eligibility']['reasonCode'] or ('canBook' if b['eligibility']['canBook'] else 'x')
u=lambda n:client(f'uat{n}@uat.test','Admin123!')
c1,c2,c3,c4,c5,c6,c9,c10,c11=[u(n) for n in (1,2,3,4,5,6,9,10,11)]
A,B_,C,D,F,G,H=S('a'),S('b'),S('c'),S('d'),S('f'),S('10'),S('11')
# ---- HAPPY PATH
s,pk,rc=opts(c1,A); rec('H1','U1 opsi booking kelas +3h (paket habis +5h)',P(1),str(pk))
s,pk,rc=opts(c1,B_); rec('H2','U1 opsi kelas +10h: paket TIDAK ditawarkan (habis sebelum kelas)','[]',str(pk))
s,c=book(c1,P(1),A); rec('H3','U1 booking kelas +3h dengan paket yang masih berlaku','OK',c)
s,pk,rc=opts(c2,B_); rec('H4','U2 opsi kelas +10h: paket 60 hari ditawarkan',P(2),str(pk))
s,c=book(c2,P(2),B_); rec('H5','U2 booking kelas +10h','OK',c)
s,c=book(c10,P(10),A); rec('H6','U10 paket multi-cabang booking di cabang MK','OK',c)
# ---- NO HAPPY PATH
s,c=book(c1,P(1),B_); rec('N1','U1 booking kelas SETELAH paket habis (kode baru, bukan INSUFFICIENT)','PACKAGE_EXPIRED_FOR_SLOT',c)
s,pk,rc=opts(c3,A); rec('N2','U3 tanpa selfie: opsi menolak','IDENTITY_VERIFICATION_REQUIRED',str(rc))
s,c=book(c3,P(3),A); rec('N3','U3 tanpa selfie: booking ditolak (konsisten dengan opsi)','IDENTITY_VERIFICATION_REQUIRED',c)
s,pk,rc=opts(c4,A); rec('N4','U4 paket beku: tidak ada paket ditawarkan','[]',str(pk))
s,c=book(c4,P(4),A); rec('N5','U4 paket beku: booking ditolak','PACKAGE_NOT_ACTIVE',c)
s,pk,rc=opts(c5,A); rec('N6','U5 pembelian PENDING: tidak ditawarkan','[]',str(pk))
s,c=book(c5,P(5),A); rec('N7','U5 pembelian PENDING: booking ditolak','PURCHASE_NOT_PAID',c)
s,c=book(c9,P(9),F); rec('N8','U9 paket cabang GG dipakai di MK','PACKAGE_BRANCH_MISMATCH',code(c))
s,c=book(c11,P(11),A); rec('N9','U11 paket Private untuk kelas Group','PACKAGE_CLASS_TYPE_MISMATCH',c)
s,c=book(c2,P(2),A); s2,c2_=book(c2,P(2),A); rec('N10','U2 booking ganda di kelas yang sama','DUPLICATE_ACTIVE_BOOKING',c2_)
s,c=book(c2,P(2),C); rec('N11','U2 booking kelas bentrok jam (kelas C sama jam dgn A)','SCHEDULE_CONFLICT',c)
s,c=book(c2,P(2),D); rec('N12','U2 booking di dalam cutoff 2 jam','BOOKING_CUTOFF_PASSED',c)
s,c=book(c6,P(6),A); rec('N13a','U6 (sisa 1 sesi) booking pertama','OK',c)
s,c=book(c6,P(6),B_); rec('N13','U6 booking kedua: sesi habis terpakai reservasi','INSUFFICIENT_AVAILABLE_SESSIONS',c)
s,c=book(c2,P(2),H); rec('N14a','U2 ambil kursi terakhir kelas kapasitas 1','OK',c)
s,c=book(c10,P(10),H); rec('N14','U10 booking kelas penuh','CLASS_CAPACITY_FULL',c)
s,c=book(c1,P(3),A); rec('N15','U1 pakai paket milik orang lain','RESOURCE_NOT_FOUND',c)
s,b=c1('POST','/bookings',{'classSlotId':A,'customerPackageId':'bukan-uuid','source':'SELF'}); rec('N16','input rusak (id bukan UUID)','VALIDATION_ERROR',code(b))
# ---- Konsistensi opsi vs booking
for uid,c_,pkg,sl in ((1,c1,1,B_),(4,c4,4,A),(5,c5,5,A),(9,c9,9,F),(11,c11,11,A)):
    s,pk,rc=opts(c_,sl); s2,cc=book(c_,P(pkg),sl)
    rec(f'K{uid}',f'U{uid}: opsi dan booking sepakat (opsi kosong = booking ditolak)','True',str(pk==[] and not cc.startswith('OK')))
# ---- ADMIN
adm=client('admin@ddose.com','Admin123!')
s,c=adm('POST','/bookings',{'classSlotId':S('14'),'customerPackageId':P(10),'customerUserId':'a0a0a0a0-0000-4000-8000-000000000010','source':'ADMIN_ASSISTED'}); rec('A1','Admin booking-kan U10 (paket multi-cabang) di GG','OK',code(c))
s,c=adm('POST','/bookings',{'classSlotId':S('12'),'customerPackageId':P(1),'customerUserId':'a0a0a0a0-0000-4000-8000-000000000001','source':'ADMIN_ASSISTED'}); rec('A2','Admin booking U1 di GG: paket dibeli di MK dan paket tanpa cabang = hanya MK (aturan cabang-paket lama)','PACKAGE_BRANCH_MISMATCH',code(c))
# daftar paket versi staf
s,b=adm('GET','/customer-packages?branchId=a1000000-0000-4000-8000-000000000001&customerUserId=a0a0a0a0-0000-4000-8000-000000000010&pageSize=20'); rec('A3','Daftar paket staf untuk U10 di GG memuat paket multi-cabang','True',str(any(i['id']==P(10) for i in b.get('items',[]))))
# walk-in
wi=lambda cust,slot,pkgid='20000000-0000-4000-8000-000000000001': adm('POST','/bookings/walk-in',{'branchId':'a1000000-0000-4000-8000-000000000001','classSlotId':slot,'customerUserId':cust,'packageId':pkgid,'paymentMethod':'CASH','paymentNote':'UAT tunai'})
s,b=wi('a0a0a0a0-0000-4000-8000-000000000007',S('12')); w=b.get('body',b); 
rec('W1','Walk-in tunai: pembelian langsung PAID',"PAID",str(w.get('purchase',{}).get('status')))
newpkg=w.get('customerPackage',{}).get('id')
s,b=adm('POST','/bookings',{'classSlotId':S('13'),'customerPackageId':newpkg,'customerUserId':'a0a0a0a0-0000-4000-8000-000000000007','source':'ADMIN_ASSISTED'}); rec('W2','Walk-in: paket baru langsung bisa dipakai booking (kelas bentrok jam → harus ditolak jadwal, bukan pembayaran)','SCHEDULE_CONFLICT',code(b))
s,b=wi('a0a0a0a0-0000-4000-8000-000000000007',S('12')); rec('W3','Walk-in ke kelas yang sama dua kali','DUPLICATE_ACTIVE_BOOKING',code(b))
s,b=wi('a0a0a0a0-0000-4000-8000-000000000008',S('12')); w8=b.get('body',b)
s,b=wi('a0a0a0a0-0000-4000-8000-000000000008',S('13')); rec('W4','Walk-in ke kelas lain yang bentrok jam dengan booking sebelumnya','SCHEDULE_CONFLICT',code(b))
s,b=wi('a0a0a0a0-0000-4000-8000-000000000009',S('13'),'20000000-0000-4000-8000-000000000005'); rec('W5','Walk-in paket cabang lain (GG-bound ke kelas OK) tetap cek tipe kelas','PACKAGE_CLASS_TYPE_MISMATCH',code(b))
s,b=wi('a0a0a0a0-0000-4000-8000-000000000008',S('13'),'3eaad9c4-49f6-411c-9856-30dd0e9bb6da'); rec('W6','Walk-in paket multi-cabang tidak ditolak karena cabang (hanya jadwal bentrok)','SCHEDULE_CONFLICT',code(b))
# ---- Timetable member: paket untuk /ledger (sumber data timetable web)
s,b=c1('GET','/customer-packages?status=ACTIVE&pageSize=100'); rec('T1','Timetable member memuat paket dgn pageSize=100','200',str(s))
fails=[r for r in rows if r[4]=='GAGAL']
print(f"\nTOTAL {len(rows)} skenario, LULUS {len(rows)-len(fails)}, GAGAL {len(fails)}")
json.dump(rows,open('/private/tmp/claude-501/uat/hasil.json','w'),ensure_ascii=False,indent=1)
