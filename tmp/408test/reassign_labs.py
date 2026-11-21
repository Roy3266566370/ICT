import pymysql

conn = pymysql.connect(host='127.0.0.1', port=3306, user='xiangsheng_app',
                       password='sZlTP-ZA9MIdWbAOpoqG3jAkyNZcWeij',
                       database='xiangsheng_dev', charset='utf8mb4')
cur = conn.cursor()
cur.execute("UPDATE labs SET session_id=%s WHERE session_id=%s",
            ('ses_c435d5d5f6284457b9c6f78279399bdc',
             'ses_12000b2588b34839999d58814672fefb'))
conn.commit()
print('reassigned:', cur.rowcount)
