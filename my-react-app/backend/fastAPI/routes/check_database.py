import sqlite3

conn = sqlite3.connect("dictionary.db")
cursor = conn.cursor()

cursor.execute("SELECT id, name, word_img FROM words LIMIT 10")
rows = cursor.fetchall()

for row in rows:
    print("ID:", row[0])
    print("Tayal Word:", row[1])
    print("Image URL:", row[2])
    print("-" * 40)

conn.close()
