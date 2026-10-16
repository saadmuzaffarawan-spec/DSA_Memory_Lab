#include <iostream>
#include <cstring>
#include <cctype>
using namespace std;
void rev(char* s) { int n = strlen(s); for (int i = 0; i < n / 2; i++) { char t = s[i]; s[i] = s[n - 1 - i]; s[n - 1 - i] = t; } }
bool pal(const char* s) { int i = 0, j = strlen(s) - 1; while (i < j) if (s[i++] != s[j--]) return false; return true; }
int main() {
    char s[] = "Hello, World";
    rev(s); cout << s << endl;
    for (char* p = s; *p; ++p) *p = toupper(*p);
    cout << s << " " << sizeof(s) << " " << strlen(s) << endl;
    cout << pal("level") << pal("hello") << endl;
    const char* words[] = {"apple", "kiwi", "banana"};
    int longest = 0; for (int i = 1; i < 3; i++) if (strlen(words[i]) > strlen(words[longest])) longest = i;
    cout << words[longest] << endl;
    int vow = 0; for (const char* p = "education"; *p; p++) if (strchr("aeiou", *p)) vow++;
    cout << vow << endl;
    char name[20] = "ab"; strcat(name, "cd"); cout << name << strcmp("a", "b") << (strncmp("abc", "abd", 2)) << endl;
    return 0;
}
