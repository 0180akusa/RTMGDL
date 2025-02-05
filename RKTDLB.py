import os
import sys
import requests
import shutil
import zipfile
import concurrent.futures
from tqdm import tqdm

class FakePDFProcessor:
    def __init__(self, x1, x2, x3, max_workers=4):
        self.x1 = x1
        self.x2 = x2
        self.x3 = x3
        self.max_workers = max_workers
        self.output_dir = os.path.join(os.getcwd(), "faker")
        self.base_url_3digit = "https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository//{}/{}/{}/webreaderHTML/complete/documents/AVED0_A0_L0_P{}.pdf"
        self.base_url_2digit = "https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository//{}/{}/{}/webreaderHTML/complete/documents/AVED0_A0_L0_P{}.pdf"

    def download_single_file(self, nb):
        """Download a single PDF file"""
        nb_str_3digit = f"{nb:03d}"
        nb_str_2digit = f"{nb:02d}"
        
        # Try 3-digit URL first
        url = self.base_url_3digit.format(self.x1, self.x2, self.x3, nb_str_3digit)
        response = requests.get(url, stream=True)
        
        # If failed, try 2-digit URL
        if response.status_code != 200:
            url = self.base_url_2digit.format(self.x1, self.x2, self.x3, nb_str_2digit)
            response = requests.get(url, stream=True)
        
        if response.status_code != 200:
            return None, None
        
        file_path = os.path.join(self.output_dir, f"AVED0_A0_L0_P{nb_str_3digit}.pdf")
        
        with open(file_path, 'wb') as file:
            response.raw.decode_content = True
            shutil.copyfileobj(response.raw, file)
        
        return file_path, nb

    def download_and_move_pdfs(self):
        """Download fake PDFs in parallel with progress bar"""
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)
        
        file_list = []
        nb = 0
        batch_size = 10  # Number of files to try downloading in each batch
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            while True:
                # Create a batch of futures
                future_to_nb = {
                    executor.submit(self.download_single_file, n): n 
                    for n in range(nb, nb + batch_size)
                }
                
                # Process completed downloads with progress bar
                successful_downloads = 0
                with tqdm(total=len(future_to_nb), desc=f"Downloading batch {nb//batch_size + 1}") as pbar:
                    for future in concurrent.futures.as_completed(future_to_nb):
                        file_path, current_nb = future.result()
                        if file_path:
                            file_list.append(file_path)
                            successful_downloads += 1
                        pbar.update(1)
                
                # If no successful downloads in this batch, we're done
                if successful_downloads == 0:
                    break
                
                nb += batch_size
        
        print(f"\nDownloaded {len(file_list)} files")
        return self.rename_files(file_list)

    def rename_files(self, file_list):
        """Rename downloaded files according to the specified pattern"""
        if not file_list:
            print("No files to rename.")
            return []
        
        renamed_files = []
        # Rename cover file
        cover_file = os.path.join(self.output_dir, "AVED0_A0_L0_P000.pdf")
        if os.path.exists(cover_file):
            new_cover_path = os.path.join(self.output_dir, "cover.pdf")
            os.rename(cover_file, new_cover_path)
            renamed_files.append(new_cover_path)
        
        # Sort files to ensure correct ordering
        sorted_files = sorted(file_list, key=lambda x: int(x.split('P')[-1].split('.')[0]))
        
        # Rename other files in pairs with progress bar
        with tqdm(total=len(sorted_files)-1, desc="Renaming files") as pbar:
            index = 2
            i = 1
            while i < len(sorted_files):
                if i + 1 < len(sorted_files):
                    file1 = sorted_files[i + 1]
                    new_name1 = os.path.join(self.output_dir, f"{index}.pdf")
                    os.rename(file1, new_name1)
                    renamed_files.append(new_name1)
                    
                    file2 = sorted_files[i]
                    new_name2 = os.path.join(self.output_dir, f"{index + 1}.pdf")
                    os.rename(file2, new_name2)
                    renamed_files.append(new_name2)
                    
                    index += 2
                    i += 2
                    pbar.update(2)
                else:
                    file = sorted_files[i]
                    new_name = os.path.join(self.output_dir, f"{index}.pdf")
                    os.rename(file, new_name)
                    renamed_files.append(new_name)
                    i += 1
                    pbar.update(1)
        
        return renamed_files

    def recover_jpeg(self, pdf_file):
        """Recover JPEG from fake PDF file"""
        try:
            jpg_file = os.path.splitext(pdf_file)[0] + '.jpg'
            
            with open(pdf_file, 'rb') as f:
                content = f.read()
                
                jpeg_start = content.find(b'\xFF\xD8')
                if jpeg_start == -1:
                    return False
                    
                jpeg_end = content.rfind(b'\xFF\xD9')
                if jpeg_end == -1:
                    return False
                
                jpeg_data = content[jpeg_start:jpeg_end + 2]
                
                with open(jpg_file, 'wb') as out_file:
                    out_file.write(jpeg_data)
                return True
                
        except Exception as e:
            print(f"Error processing {pdf_file}: {str(e)}")
            return False

    def process_pdfs_parallel(self, pdf_files):
        """Process PDFs to JPGs in parallel with progress bar"""
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_pdf = {
                executor.submit(self.recover_jpeg, pdf_file): pdf_file 
                for pdf_file in pdf_files
            }
            
            processed = 0
            with tqdm(total=len(pdf_files), desc="Converting PDFs to JPGs") as pbar:
                for future in concurrent.futures.as_completed(future_to_pdf):
                    pdf_file = future_to_pdf[future]
                    try:
                        if future.result():
                            processed += 1
                    except Exception as e:
                        print(f"Error processing {pdf_file}: {str(e)}")
                    pbar.update(1)
            
        return processed

    def zip_and_clean_files(self, zip_name='digital.zip'):
        """Zip JPG files and clean up temporary files with progress bar"""
        try:
            jpg_files = [f for f in os.listdir(self.output_dir) if f.lower().endswith('.jpg')]
            
            if not jpg_files:
                print("No JPG files found!")
                return False
            
            with tqdm(total=len(jpg_files), desc="Creating ZIP file") as pbar:
                with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for jpg_file in jpg_files:
                        jpg_path = os.path.join(self.output_dir, jpg_file)
                        zipf.write(jpg_path, jpg_file)
                        pbar.update(1)
            
            if os.path.exists(zip_name) and os.path.getsize(zip_name) > 0:
                shutil.rmtree(self.output_dir)
                print(f"\nAll files zipped to: {zip_name}")
                print("Cleaned up temporary files and faker directory")
                return True
            else:
                print("\nZIP file creation failed, temporary files retained")
                return False
            
        except Exception as e:
            print(f"\nError during file processing: {str(e)}")
            return False

    def process_all(self):
        """Main process to handle all operations"""
        print("Starting download process...")
        renamed_files = self.download_and_move_pdfs()
        
        if not renamed_files:
            print("No files were downloaded successfully.")
            return
        
        print("\nConverting PDFs to JPGs...")
        processed = self.process_pdfs_parallel(renamed_files)
        print(f"\nSuccessfully processed {processed} files.")
        
        print("\nCreating zip file and cleaning up...")
        self.zip_and_clean_files()

def main():
    if len(sys.argv) != 4:
        print("Usage: python script.py X1 X2 X3")
        sys.exit(1)
    
    x1, x2, x3 = sys.argv[1:4]
    processor = FakePDFProcessor(x1, x2, x3)
    processor.process_all()

if __name__ == "__main__":
    main()