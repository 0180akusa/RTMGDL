import os
import sys
import requests
import shutil
import zipfile

class FakePDFProcessor:
    def __init__(self, x1, x2, x3):
        self.x1 = x1
        self.x2 = x2
        self.x3 = x3
        self.output_dir = os.path.join(os.getcwd(), "faker")
        self.base_url_3digit = "https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository//{}/{}/{}/webreaderHTML/complete/documents/AVED0_A0_L0_P{}.pdf"
        self.base_url_2digit = "https://data-cloudauthoring.magazine.rakuten.co.jp/rem_repository//{}/{}/{}/webreaderHTML/complete/documents/AVED0_A0_L0_P{}.pdf"

    def download_and_move_pdfs(self):
        """Download fake PDFs and organize them in the faker directory"""
        if not os.path.exists(self.output_dir):
            os.makedirs(self.output_dir)
        
        nb = 0
        file_list = []
        
        while True:
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
                print(f"Stopped: No more files found at {url}")
                break
            
            file_path = os.path.join(self.output_dir, f"AVED0_A0_L0_P{nb_str_3digit}.pdf")
            
            with open(file_path, 'wb') as file:
                response.raw.decode_content = True
                shutil.copyfileobj(response.raw, file)
            print(f"Downloaded: {file_path}")
            file_list.append(file_path)
            nb += 1
        
        self.rename_files(file_list)

    def rename_files(self, file_list):
        """Rename downloaded files according to the specified pattern"""
        if not file_list:
            print("No files to rename.")
            return
        
        # Rename cover file
        cover_file = os.path.join(self.output_dir, "AVED0_A0_L0_P000.pdf")
        if os.path.exists(cover_file):
            new_cover_path = os.path.join(self.output_dir, "cover.pdf")
            os.rename(cover_file, new_cover_path)
            print(f"Renamed: {cover_file} -> {new_cover_path}")
        
        # Rename other files in pairs
        index = 2
        i = 1
        while i < len(file_list):
            if i + 1 < len(file_list):
                file1 = file_list[i + 1]
                new_name1 = os.path.join(self.output_dir, f"{index}.pdf")
                os.rename(file1, new_name1)
                print(f"Renamed: {file1} -> {new_name1}")
                
                file2 = file_list[i]
                new_name2 = os.path.join(self.output_dir, f"{index + 1}.pdf")
                os.rename(file2, new_name2)
                print(f"Renamed: {file2} -> {new_name2}")
                
                index += 2
                i += 2
            else:
                file = file_list[i]
                new_name = os.path.join(self.output_dir, f"{index}.pdf")
                os.rename(file, new_name)
                print(f"Renamed: {file} -> {new_name}")
                i += 1

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
                    
                print(f"Processed: {pdf_file} -> {jpg_file}")
                return True
                
        except Exception as e:
            print(f"Error processing {pdf_file}: {str(e)}")
            return False

    def zip_and_clean_files(self, zip_name='digital.zip'):
        """Zip JPG files and clean up temporary files"""
        try:
            # Get all jpg files from faker directory
            jpg_files = [f for f in os.listdir(self.output_dir) if f.lower().endswith('.jpg')]
            
            if not jpg_files:
                print("No JPG files found!")
                return False
                
            # Create ZIP file in the current directory
            with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for jpg_file in jpg_files:
                    jpg_path = os.path.join(self.output_dir, jpg_file)
                    print(f"Adding to zip: {jpg_file}")
                    # Add file to zip with just the filename, not the full path
                    zipf.write(jpg_path, jpg_file)
            
            if os.path.exists(zip_name) and os.path.getsize(zip_name) > 0:
                # Remove the faker directory and all its contents
                shutil.rmtree(self.output_dir)
                print(f"All JPG files zipped to: {zip_name}")
                print("Cleaned up temporary files and faker directory")
                return True
            else:
                print("ZIP file creation failed, temporary files retained")
                return False
            
        except Exception as e:
            print(f"Error during file processing: {str(e)}")
            return False

    def process_all(self):
        """Main process to handle all operations"""
        print("Starting download process...")
        self.download_and_move_pdfs()
        
        print("\nConverting PDFs to JPGs...")
        pdf_files = [f for f in os.listdir(self.output_dir) if f.lower().endswith('.pdf')]
        
        if not pdf_files:
            print("No PDF files found!")
            return
        
        processed = 0
        for pdf_file in pdf_files:
            pdf_path = os.path.join(self.output_dir, pdf_file)
            if self.recover_jpeg(pdf_path):
                processed += 1
        
        print(f"Successfully processed {processed} files.")
        
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