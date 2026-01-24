@echo off
echo ===============================================
echo 🧹 Menghapus jejak .env dari Git history...
echo ===============================================

REM Pastikan .env tidak lagi dilacak
git rm --cached .env 2>nul

REM Tambahkan ke .gitignore jika belum ada
echo node_modules/>> .gitignore
echo .env>> .gitignore

REM Commit perubahan
git add .gitignore
git commit -m "Remove .env and add to .gitignore"

REM Cek apakah git-filter-repo sudah terinstal
python -m pip show git-filter-repo >nul 2>&1
if errorlevel 1 (
    echo 🔧 Menginstal git-filter-repo...
    python -m pip install git-filter-repo
)

REM Jalankan filter untuk hapus history .env
echo 🔥 Membersihkan seluruh jejak .env dari repository...
git filter-repo --path .env --invert-paths

REM Force push ke GitHub
echo 🚀 Melakukan push paksa ke GitHub...
git push origin main --force

echo ===============================================
echo ✅ Selesai! Semua jejak .env sudah dihapus.
echo Sekarang repository kamu bersih dan aman.
echo ===============================================
pause